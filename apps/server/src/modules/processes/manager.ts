import { type ChildProcess, spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import {
  commandEnvironment,
  FileManagerError,
  groupAlive,
  isInteractiveExecutable,
  OutputRedactor,
  processAlive,
  resolveFilePath,
  stopCommandGroup,
  terminateProcessTree,
  windowsLaunch,
} from "@larness/resources";
import {
  PROCESS_OUTPUT_MAX_BYTES,
  PROCESS_OUTPUT_MAX_CHUNKS,
  type ProcessDto,
  type ProcessOutputChunk,
  type ProcessOutputPage,
  type ProcessStatus,
  ProcessStatusSchema,
  StartProcessParamsSchema,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { SecretStore } from "../../security/secretStore.js";
import { activeCommandClient } from "../commands/repository.js";
import { assertFileScopeMetadata, authorizeFileTarget, resolveFileScope } from "../files/scope.js";
import { listEncryptedSecrets } from "../models/repository.js";
import { getSessionById, getTurnById } from "../sessions/repository.js";

export interface ProcessLifecycleEvent {
  type: "process.started" | "process.exited" | "process.stopped";
  sessionId: string;
  turnId: string;
  payload: Record<string, unknown>;
}

export interface ProcessContext {
  sessionId: string;
  turnId: string;
  toolCallId: string;
  clientSessionId: string;
  policySnapshotId: string;
  assertAuthorized: () => void;
  signal?: AbortSignal;
}

export interface ProcessManagerOptions {
  db: Database;
  dataDir: string;
  secretStore?: SecretStore;
  idleTtlMinutes?: number;
  now?: () => number;
  onEvent?: (event: ProcessLifecycleEvent) => void;
  stopGraceMs?: number;
}

interface ManagedProcess {
  id: string;
  sessionId: string;
  turnId: string;
  projectId: string | null;
  idempotencyKey: string;
  name: string | null;
  executable: string;
  args: string[];
  cwd: string;
  child: ChildProcess;
  pid: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  reasonCode: string | null;
  startedAt: number | null;
  endedAt: number | null;
  stopRequested: boolean;
  output: ProcessOutputBuffer;
  stopPromise: Promise<{ stopped: boolean; forced: boolean }> | null;
}

class ProcessOutputBuffer {
  readonly #chunks: ProcessOutputChunk[] = [];
  #bytes = 0;
  #cursor = 0;
  #oldestCursor = 1;
  #truncated = false;

  append(channel: "stdout" | "stderr", data: string, now: number): void {
    if (data.length === 0) return;
    const cursor = ++this.#cursor;
    this.#chunks.push({ cursor, data, channel, timestamp: now });
    this.#bytes += Buffer.byteLength(data, "utf8");
    while (
      this.#bytes > PROCESS_OUTPUT_MAX_BYTES ||
      this.#chunks.length > PROCESS_OUTPUT_MAX_CHUNKS
    ) {
      const removed = this.#chunks.shift();
      if (removed === undefined) break;
      this.#bytes -= Buffer.byteLength(removed.data, "utf8");
      this.#oldestCursor = removed.cursor + 1;
      this.#truncated = true;
    }
  }

  get cursor(): number {
    return this.#cursor;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  read(after: number, limit: number): ProcessOutputPage {
    const resyncRequired = after + 1 < this.#oldestCursor;
    const chunks = this.#chunks.filter((chunk) => chunk.cursor > after).slice(0, limit);
    return {
      chunks,
      oldestCursor: this.#oldestCursor,
      nextCursor: chunks.at(-1)?.cursor ?? after,
      truncated: this.#truncated,
      resyncRequired,
    };
  }
}

function fail(code: ConstructorParameters<typeof FileManagerError>[0], message: string): never {
  throw new FileManagerError(code, message);
}

function ensureStatus(value: string): ProcessStatus {
  return ProcessStatusSchema.parse(value);
}

export class ProcessManager {
  readonly #processes = new Map<string, ManagedProcess>();
  readonly #options: ProcessManagerOptions;
  #closed = false;

  constructor(options: ProcessManagerOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #client(clientSessionId: string): void {
    if (
      !activeCommandClient(
        this.#options.db,
        clientSessionId,
        this.#now(),
        this.#options.idleTtlMinutes,
      )
    ) {
      fail("UNAUTHENTICATED", "Client session is not active");
    }
  }

  #dto(row: ManagedProcess): ProcessDto {
    return {
      id: row.id,
      projectId: row.projectId,
      sessionId: row.sessionId,
      name: row.name,
      status: row.status,
      executable: row.executable,
      cwd: row.cwd,
      pid: row.pid,
      exitCode: row.exitCode,
      reasonCode: row.reasonCode,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      outputCursor: row.output.cursor,
      truncated: row.output.truncated,
    };
  }

  #emit(row: ManagedProcess, type: ProcessLifecycleEvent["type"], extra = {}): void {
    try {
      this.#options.onEvent?.({
        type,
        sessionId: row.sessionId,
        turnId: row.turnId,
        payload: {
          processId: row.id,
          name: row.name,
          status: row.status,
          executable: row.executable,
          cwd: row.cwd,
          pid: row.pid,
          exitCode: row.exitCode,
          reasonCode: row.reasonCode,
          ...extra,
        },
      });
    } catch {
      // Lifecycle persistence is best effort for exit events; start fails closed
      // before returning a RUNNING process if the callback throws.
    }
  }

  #secretCheck(values: string[]): void {
    const encrypted = listEncryptedSecrets(this.#options.db);
    if (encrypted.length === 0) return;
    if (this.#options.secretStore === undefined)
      fail("INTERNAL", "Process output protection unavailable");
    for (const secret of encrypted) {
      let plaintext: string;
      try {
        plaintext = this.#options.secretStore.decrypt(secret);
      } catch {
        fail("INTERNAL", "Process output protection unavailable");
      }
      if (plaintext.length > 0 && values.some((value) => value.includes(plaintext))) {
        fail("FORBIDDEN", "Protected credentials cannot be process arguments");
      }
    }
  }

  async start(context: ProcessContext, input: unknown): Promise<ProcessDto> {
    if (this.#closed) fail("RESOURCE_UNAVAILABLE", "Process execution unavailable");
    const parsed = StartProcessParamsSchema.safeParse(input);
    if (!parsed.success) fail("VALIDATION_ERROR", "Invalid process request");
    const params = parsed.data;
    this.#client(context.clientSessionId);
    const session = getSessionById(this.#options.db, context.sessionId);
    const turn = getTurnById(this.#options.db, context.turnId);
    if (
      session?.status !== "active" ||
      turn === null ||
      turn.sessionId !== session.id ||
      !["RUNNING", "PREPARING"].includes(turn.status)
    ) {
      fail("FORBIDDEN", "Process context is not active");
    }
    if (context.signal?.aborted) fail("RESOURCE_UNAVAILABLE", "Process cancelled");
    if (isInteractiveExecutable(params.executable, params.args)) {
      fail("INTERACTIVE_COMMAND", "Interactive terminal commands are not supported");
    }
    this.#secretCheck([params.executable, params.cwd, ...params.args]);

    const scope = await resolveFileScope(
      this.#options.db,
      this.#options.dataDir,
      session.projectId ? { projectId: session.projectId } : { sessionId: session.id },
    );
    const cwd = await authorizeFileTarget(scope, params.cwd);
    const absolute = await resolveFilePath(scope.root, cwd);
    if (!(await lstat(absolute)).isDirectory())
      fail("INVALID_CWD", "Process cwd must be a directory");

    const idempotencyKey = `${context.turnId}:${context.toolCallId}`;
    const existing = [...this.#processes.values()].find(
      (row) => row.sessionId === session.id && row.idempotencyKey === idempotencyKey,
    );
    if (existing !== undefined) return this.#dto(existing);

    if (params.name !== undefined) {
      const named = [...this.#processes.values()].find(
        (row) =>
          row.projectId === session.projectId &&
          row.name === params.name &&
          ["STARTING", "RUNNING", "STOPPING"].includes(row.status),
      );
      if (named !== undefined) {
        if (
          named.executable !== params.executable ||
          named.args.join("\0") !== params.args.join("\0") ||
          named.cwd !== cwd
        ) {
          fail("CONFLICT", "A process with this name already uses different parameters");
        }
        return this.#dto(named);
      }
    }

    context.assertAuthorized();
    assertFileScopeMetadata(this.#options.db, scope);

    const id = newId("prc");
    const launch =
      process.platform === "win32"
        ? windowsLaunch(params.executable, params.args, absolute)
        : { executable: params.executable, args: params.args };
    const child = spawn(launch.executable, launch.args, {
      cwd: absolute,
      env: commandEnvironment(),
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const row: ManagedProcess = {
      id,
      sessionId: session.id,
      turnId: context.turnId,
      projectId: session.projectId,
      idempotencyKey,
      name: params.name ?? null,
      executable: params.executable,
      args: params.args,
      cwd,
      child,
      pid: child.pid ?? null,
      status: "STARTING",
      exitCode: null,
      reasonCode: null,
      startedAt: null,
      endedAt: null,
      stopRequested: false,
      output: new ProcessOutputBuffer(),
      stopPromise: null,
    };
    this.#processes.set(id, row);

    for (const channel of ["stdout", "stderr"] as const) {
      const decoder = new StringDecoder("utf8");
      const redactor = new OutputRedactor(
        listEncryptedSecrets(this.#options.db).map(
          (secret) => this.#options.secretStore?.decrypt(secret) ?? "",
        ),
      );
      child[channel].on("data", (bytes: Buffer) => {
        row.output.append(channel, redactor.push(decoder.write(bytes)), this.#now());
      });
      child[channel].on("end", () => {
        row.output.append(channel, redactor.push(decoder.end(), true), this.#now());
      });
    }

    const spawned = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Process spawn timed out")), 5_000);
      timer.unref?.();
      child.once("spawn", () => {
        clearTimeout(timer);
        row.status = ensureStatus("RUNNING");
        row.pid = child.pid ?? null;
        row.startedAt = this.#now();
        this.#emit(row, "process.started");
        appendAudit(this.#options.db, {
          action: "process.started",
          decision: "allow",
          clientSessionId: context.clientSessionId,
          sessionId: row.sessionId,
          resourceType: "process",
          resourceId: row.id,
          details: { projectId: row.projectId, name: row.name, executable: row.executable },
          now: this.#now(),
        });
        resolve();
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        row.status = ensureStatus("FAILED");
        row.reasonCode = error.code === "ENOENT" ? "COMMAND_NOT_FOUND" : "SPAWN_FAILED";
        row.endedAt = this.#now();
        this.#emit(row, "process.exited");
        reject(
          new FileManagerError(
            row.reasonCode === "COMMAND_NOT_FOUND" ? "COMMAND_NOT_FOUND" : "RESOURCE_UNAVAILABLE",
            "Process could not be started",
          ),
        );
      });
    });

    child.once("exit", (code, signal) => {
      row.exitCode = code;
      row.endedAt = this.#now();
      if (row.status === "STOPPING" || row.stopRequested) {
        row.status = ensureStatus("STOPPED");
        row.reasonCode ??= signal === null ? null : "SIGNALED";
      } else if (code === 0) {
        row.status = ensureStatus("EXITED");
        row.reasonCode = null;
      } else {
        row.status = ensureStatus("FAILED");
        row.reasonCode ??= "NONZERO_EXIT";
      }
      this.#emit(row, "process.exited");
    });

    try {
      await spawned;
    } catch (error) {
      this.#processes.delete(id);
      throw error;
    }
    context.assertAuthorized();
    return this.#dto(row);
  }

  #find(id: string, projectId: string | null, sessionId: string): ManagedProcess {
    const row = this.#processes.get(id);
    if (row === undefined) fail("NOT_FOUND", "Process not found");
    if (row.sessionId !== sessionId && row.projectId !== projectId)
      fail("FORBIDDEN", "Process does not belong to this scope");
    return row;
  }

  async readOutput(
    id: string,
    context: Pick<ProcessContext, "sessionId"> & {
      clientSessionId?: string;
      projectId?: string | null;
    },
    after: number,
    limit: number,
  ): Promise<ProcessOutputPage> {
    if (context.clientSessionId !== undefined) this.#client(context.clientSessionId);
    const row = this.#find(id, context.projectId ?? null, context.sessionId);
    return row.output.read(after, limit);
  }

  async stop(
    id: string,
    context: Pick<ProcessContext, "sessionId"> & {
      clientSessionId?: string;
      projectId?: string | null;
    },
  ): Promise<{ process: ProcessDto; stopped: boolean; forced: boolean }> {
    if (context.clientSessionId !== undefined) this.#client(context.clientSessionId);
    const row = this.#find(id, context.projectId ?? null, context.sessionId);
    if (["EXITED", "STOPPED", "FAILED"].includes(row.status)) {
      return { process: this.#dto(row), stopped: true, forced: false };
    }
    if (row.stopPromise !== null) {
      const result = await row.stopPromise;
      return { process: this.#dto(row), ...result };
    }
    row.status = ensureStatus("STOPPING");
    row.stopRequested = true;
    row.stopPromise = (async () => {
      const pid = row.pid;
      if (pid === null) return { stopped: true, forced: false };
      let stopped = false;
      let forced = false;
      if (process.platform === "win32") {
        stopped = await terminateProcessTree(pid, this.#options.stopGraceMs ?? 2_000);
      } else {
        stopped = await stopCommandGroup(pid, this.#options.stopGraceMs ?? 300);
        if (!stopped) {
          forced = true;
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* The group may already be gone. */
          }
          const deadline = Date.now() + 2_000;
          while (Date.now() < deadline && processAlive(pid)) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          stopped = !(await groupAlive(pid));
        }
      }
      row.endedAt = this.#now();
      if (stopped) {
        row.status = ensureStatus("STOPPED");
      } else {
        row.status = ensureStatus("FAILED");
        row.reasonCode = "STOP_UNCONFIRMED";
      }
      this.#emit(row, "process.stopped", { forced });
      appendAudit(this.#options.db, {
        action: "process.stopped",
        decision: stopped ? "allow" : "deny",
        sessionId: row.sessionId,
        resourceType: "process",
        resourceId: row.id,
        details: { forced, status: row.status },
        now: this.#now(),
      });
      return { stopped, forced };
    })();
    const result = await row.stopPromise;
    return { process: this.#dto(row), ...result };
  }

  list(filter: { projectId?: string; sessionId?: string } = {}): ProcessDto[] {
    return [...this.#processes.values()]
      .filter(
        (row) =>
          (filter.projectId === undefined || row.projectId === filter.projectId) &&
          (filter.sessionId === undefined || row.sessionId === filter.sessionId),
      )
      .map((row) => this.#dto(row));
  }

  get(id: string): ProcessDto {
    const row = this.#processes.get(id);
    if (row === undefined) fail("NOT_FOUND", "Process not found");
    return this.#dto(row);
  }

  async close(): Promise<void> {
    this.#closed = true;
    const active = [...this.#processes.values()].filter((row) =>
      ["STARTING", "RUNNING", "STOPPING"].includes(row.status),
    );
    await Promise.allSettled(active.map((row) => this.stop(row.id, { sessionId: row.sessionId })));
  }
}
