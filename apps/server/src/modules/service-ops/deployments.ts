import { rm } from "node:fs/promises";
import path from "node:path";
import {
  canonicalDirectory,
  isInsideRoot,
  resolveInsideRoot,
  runCommand,
  runGit,
} from "@larness/resources";
import {
  DEPLOYMENT_ARTIFACT_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_MAX_FILES,
  DEPLOYMENT_PLAN_TTL_MS,
  type DeploymentArtifactDto,
  type DeploymentBuildDto,
  type DeploymentBuildStatus,
  type DeploymentPlanDocument,
  DeploymentPlanDocumentSchema,
  type DeploymentPlanDto,
  type DeploymentSource,
  type DeploymentSpec,
  DeploymentSpecSchema,
  type DeploymentTargetDto,
  DeploymentTargetRefSchema,
  type DeploymentVersion,
  hasControlCharacters,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import type {
  DeploymentArtifactRow,
  DeploymentBuildRow,
  DeploymentPlanRow,
  DeploymentTargetRow,
} from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { acquireResourceLock, releaseResourceLock, renewResourceLock } from "../locks/service.js";
import { getProjectById } from "../projects/repository.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { DeploymentError } from "./errors.js";
import {
  artifactByBuildId,
  artifactById,
  artifactDto,
  buildById,
  buildByRequestKey,
  buildDto,
  insertArtifact,
  insertBuild,
  insertPlan,
  insertTarget,
  planById,
  planByRequestKey,
  planDto,
  runningBuilds,
  storedSource,
  storedSpec,
  targetById,
  targetByName,
  targetDto,
  updateBuild,
  updatePlanStatus,
} from "./repository.js";
import {
  type ArtifactLimits,
  ArtifactStorageError,
  artifactDirectory,
  type BuildLog,
  buildLogRef,
  commitArtifact,
  createBuildLog,
  ensureDeploymentStorage,
  readDeploymentLog,
  removeStagedArtifact,
  stageArtifact,
  verifyStoredArtifact,
} from "./storage.js";

export { deploymentArtifactRoot, deploymentLogRoot } from "./storage.js";

const DEFAULT_LOCK_TTL_MS = 30_000;
const LOCK_RENEW_MS = 10_000;

export interface DeploymentManagerOptions {
  db: Database;
  dataDir: string;
  now?: () => number;
  secrets?: () => string[];
  maxArtifactBytes?: number;
  maxArtifactFiles?: number;
  reservedPorts?: number[];
}

export interface BuildInput {
  projectId: string;
  target: unknown;
  spec: unknown;
  requestKey: string;
  requestedBy: string;
  signal?: AbortSignal;
  onStarted?: (build: DeploymentBuildDto) => void;
}

export interface CreatePlanInput {
  artifactId: string;
  requestKey: string;
  requestedBy: string;
  expectedCurrentArtifactId?: string | null;
}

export type ArtifactVerification = {
  valid: boolean;
  code?: "ARTIFACT_MISSING" | "ARTIFACT_HASH_MISMATCH" | "DEPLOY_UNAVAILABLE";
};

export type PlanVerification = {
  valid: boolean;
  code?:
    | "PLAN_NOT_FOUND"
    | "PLAN_EXPIRED"
    | "PLAN_INVALID"
    | "PLAN_STALE"
    | "ARTIFACT_MISSING"
    | "ARTIFACT_HASH_MISMATCH"
    | "DEPLOY_UNAVAILABLE";
};

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof (error as { code?: unknown } | null)?.code === "string" &&
    ((error as { code: string }).code.startsWith("SQLITE_CONSTRAINT_UNIQUE") ||
      (error as { code: string }).code.startsWith("SQLITE_CONSTRAINT_PRIMARYKEY"))
  );
}

function assertText(value: unknown, field: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    hasControlCharacters(value)
  ) {
    throw new DeploymentError("DEPLOY_SPEC_INVALID", `Invalid ${field}`);
  }
  return value;
}

function parseSpec(value: unknown): DeploymentSpec {
  const parsed = DeploymentSpecSchema.safeParse(value);
  if (!parsed.success) {
    throw new DeploymentError("DEPLOY_SPEC_INVALID", "Invalid deployment specification");
  }
  return parsed.data;
}

function hasGitSegment(value: string): boolean {
  return value.split("/").includes(".git");
}

export class DeploymentManager {
  readonly db: Database;
  readonly #dataDir: string;
  readonly #now: () => number;
  readonly #secrets: () => string[];
  readonly #limits: ArtifactLimits;
  readonly #reservedPorts: Set<number>;
  readonly #active = new Map<string, AbortController>();
  readonly #pending = new Set<Promise<unknown>>();

  constructor(options: DeploymentManagerOptions) {
    this.db = options.db;
    this.#dataDir = options.dataDir;
    this.#now = options.now ?? Date.now;
    this.#secrets = options.secrets ?? (() => []);
    this.#limits = {
      maxBytes: options.maxArtifactBytes ?? DEPLOYMENT_ARTIFACT_MAX_BYTES,
      maxFiles: options.maxArtifactFiles ?? DEPLOYMENT_ARTIFACT_MAX_FILES,
    };
    this.#reservedPorts = new Set(options.reservedPorts ?? []);
  }

  async close(): Promise<void> {
    for (const controller of this.#active.values()) controller.abort();
    await Promise.allSettled([...this.#pending]);
  }

  ensureTarget(input: { projectId: string; name: string }): DeploymentTargetDto {
    return this.resolveTarget({
      projectId: input.projectId,
      target: { name: input.name },
    });
  }

  resolveTarget(input: { projectId: string; target: unknown }): DeploymentTargetDto {
    if (typeof input.projectId !== "string" || input.projectId.length === 0) {
      throw new DeploymentError("DEPLOY_TARGET_INVALID", "Invalid deployment project");
    }
    const project = getProjectById(this.db, input.projectId);
    if (!project) {
      throw new DeploymentError("DEPLOY_TARGET_INVALID", "Deployment project was not found");
    }
    const parsed = DeploymentTargetRefSchema.safeParse(input.target);
    if (!parsed.success) {
      throw new DeploymentError("DEPLOY_TARGET_INVALID", "Invalid formal deployment target");
    }
    if ("targetId" in parsed.data) {
      const row = targetById(this.db, parsed.data.targetId);
      if (!row || row.projectId !== input.projectId) {
        throw new DeploymentError("DEPLOY_TARGET_INVALID", "Deployment target was not found");
      }
      return targetDto(row);
    }
    const existing = targetByName(this.db, input.projectId, parsed.data.name);
    if (existing) return targetDto(existing);
    const now = this.#now();
    const row: DeploymentTargetRow = {
      id: newId("tgt"),
      projectId: input.projectId,
      name: parsed.data.name,
      currentArtifactId: null,
      currentVersion: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      immediateTransaction(this.db, (tx) => insertTarget(tx, row));
      return targetDto(row);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const raced = targetByName(this.db, input.projectId, parsed.data.name);
      if (!raced) throw new DeploymentError("DEPLOY_CONFLICT", "Deployment target conflict");
      return targetDto(raced);
    }
  }

  async build(input: BuildInput): Promise<DeploymentBuildDto> {
    const requestKey = assertText(input.requestKey, "request key", 256);
    const requestedBy = assertText(input.requestedBy, "requested by", 128);
    const spec = parseSpec(input.spec);
    const specJson = canonicalJson(spec);
    const specHash = sha256(specJson);
    const project = getProjectById(this.db, input.projectId);
    if (!project) {
      throw new DeploymentError("DEPLOY_TARGET_INVALID", "Deployment project was not found");
    }
    const target = this.resolveTarget({
      projectId: input.projectId,
      target: input.target,
    });

    const existing = buildByRequestKey(this.db, requestKey);
    if (existing) {
      if (
        existing.projectId !== input.projectId ||
        existing.targetId !== target.id ||
        existing.specHash !== specHash
      ) {
        throw new DeploymentError("DEPLOY_CONFLICT", "Request key belongs to another build");
      }
      if (existing.status === "RUNNING") {
        throw new DeploymentError("DEPLOY_CONFLICT", "Build is already running");
      }
      return buildDto(existing);
    }

    if (this.#reservedPorts.has(spec.health.port)) {
      throw new DeploymentError("DEPLOY_SPEC_INVALID", "Health port is reserved by Larness");
    }
    if (hasGitSegment(spec.build.outputDir)) {
      throw new DeploymentError("DEPLOY_SPEC_INVALID", "Build output cannot target .git");
    }

    let root: string;
    let cwd: string;
    try {
      root = await canonicalDirectory(project.realPath);
      cwd = await canonicalDirectory(path.resolve(root, spec.build.cwd));
      if (!isInsideRoot(root, cwd)) throw new Error("outside");
      const output = await resolveInsideRoot(root, spec.build.outputDir);
      if (!isInsideRoot(root, output) || output === root) throw new Error("outside");
    } catch {
      throw new DeploymentError("DEPLOY_SPEC_INVALID", "Build path is outside the project");
    }

    await ensureDeploymentStorage(this.#dataDir).catch(() => {
      throw new DeploymentError("DEPLOY_UNAVAILABLE", "Deployment storage is unavailable");
    });

    const buildId = newId("bld");
    const now = this.#now();
    const lock = acquireResourceLock(
      { db: this.db, now: this.#now },
      {
        resourceType: "project",
        resourceId: input.projectId,
        owner: `deployment:${requestedBy}`,
        executionId: buildId,
        ttlMs: DEFAULT_LOCK_TTL_MS,
        rootRealPath: root,
      },
    );
    if (!lock) {
      throw new DeploymentError("RESOURCE_LOCKED", "Project has an active writer");
    }

    const row: DeploymentBuildRow = {
      id: buildId,
      targetId: target.id,
      projectId: input.projectId,
      requestKey,
      requestedBy,
      status: "RUNNING",
      specJson,
      specHash,
      reasonCode: null,
      logRef: buildLogRef(buildId),
      startedAt: now,
      endedAt: null,
      createdAt: now,
    };
    immediateTransaction(this.db, (tx) => insertBuild(tx, row));

    let log: BuildLog;
    try {
      log = await createBuildLog(this.#dataDir, buildId);
    } catch {
      updateBuild(this.db, buildId, {
        status: "FAILED",
        reasonCode: "DEPLOY_UNAVAILABLE",
        endedAt: this.#now(),
      });
      releaseResourceLock(
        { db: this.db, now: this.#now },
        { id: lock.id, fencingToken: lock.fencingToken },
      );
      throw new DeploymentError("DEPLOY_UNAVAILABLE", "Deployment log is unavailable");
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    this.#active.set(buildId, controller);

    try {
      const started = buildDto(row);
      try {
        input.onStarted?.(started);
      } catch {
        log.close();
        releaseResourceLock(
          { db: this.db, now: this.#now },
          { id: lock.id, fencingToken: lock.fencingToken },
        );
        updateBuild(this.db, buildId, {
          status: "FAILED",
          reasonCode: "START_FAILED",
          endedAt: this.#now(),
        });
        throw new DeploymentError("DEPLOY_BUILD_FAILED", "Build start hook failed");
      }
      const promise = this.#executeBuild({
        buildId,
        row,
        spec,
        projectId: input.projectId,
        target,
        root,
        cwd,
        controller,
        log,
        lock,
      });
      this.#pending.add(promise);
      try {
        return await promise;
      } finally {
        this.#pending.delete(promise);
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      this.#active.delete(buildId);
    }
  }

  async #executeBuild(input: {
    buildId: string;
    row: DeploymentBuildRow;
    spec: DeploymentSpec;
    projectId: string;
    target: DeploymentTargetDto;
    root: string;
    cwd: string;
    controller: AbortController;
    log: BuildLog;
    lock: NonNullable<ReturnType<typeof acquireResourceLock>>;
  }): Promise<DeploymentBuildDto> {
    let lockLost = false;
    const renew = setInterval(() => {
      const renewed = renewResourceLock(
        { db: this.db, now: this.#now },
        {
          id: input.lock.id,
          fencingToken: input.lock.fencingToken,
          ttlMs: DEFAULT_LOCK_TTL_MS,
        },
      );
      if (!renewed) {
        lockLost = true;
        input.controller.abort();
      }
    }, LOCK_RENEW_MS);
    renew.unref();

    let result: Awaited<ReturnType<typeof runCommand>> | null = null;
    let failure: string | null = null;
    try {
      result = await runCommand({
        executable: input.spec.build.command[0],
        args: input.spec.build.command.slice(1),
        cwd: input.cwd,
        timeoutMs: input.spec.build.timeoutMs,
        secrets: this.#secrets(),
        signal: input.controller.signal,
        onOutput: (chunk) => input.log.append(chunk),
      });
    } catch {
      failure = "SPAWN_FAILED";
    } finally {
      clearInterval(renew);
      input.log.close();
      releaseResourceLock(
        { db: this.db, now: this.#now },
        { id: input.lock.id, fencingToken: input.lock.fencingToken },
      );
    }

    if (result === null) {
      return this.#finishBuild(input.buildId, "FAILED", failure ?? "SPAWN_FAILED");
    }
    if (lockLost) return this.#finishBuild(input.buildId, "FAILED", "LOCK_LOST");
    if (result.reasonCode === "CANCELLED") {
      return this.#finishBuild(input.buildId, "CANCELLED", "CANCELLED");
    }
    if (result.reasonCode === "TIMED_OUT") {
      return this.#finishBuild(input.buildId, "FAILED", "TIMED_OUT");
    }
    if (result.reasonCode !== null) {
      return this.#finishBuild(
        input.buildId,
        "FAILED",
        result.reasonCode === "NONZERO_EXIT" ? "BUILD_FAILED" : result.reasonCode,
      );
    }
    if (result.exitCode !== 0) {
      return this.#finishBuild(input.buildId, "FAILED", "BUILD_FAILED");
    }

    let outputDirectory: string;
    try {
      outputDirectory = await canonicalDirectory(
        path.resolve(input.root, input.spec.build.outputDir),
      );
      if (!isInsideRoot(input.root, outputDirectory) || outputDirectory === input.root) {
        throw new Error("outside");
      }
    } catch {
      return this.#finishBuild(input.buildId, "FAILED", "OUTPUT_INVALID");
    }

    const artifactId = newId("art");
    let artifactPath: string;
    let staged: Awaited<ReturnType<typeof stageArtifact>>;
    try {
      staged = await stageArtifact({
        dataDir: this.#dataDir,
        targetId: input.target.id,
        artifactId,
        buildId: input.buildId,
        outputDirectory,
        limits: this.#limits,
      });
      artifactPath = await commitArtifact(this.#dataDir, staged);
    } catch (error) {
      await removeStagedArtifact(this.#dataDir, input.buildId).catch(() => undefined);
      if (error instanceof ArtifactStorageError) {
        return this.#finishBuild(input.buildId, "FAILED", error.code);
      }
      return this.#finishBuild(input.buildId, "FAILED", "OUTPUT_INVALID");
    }

    const source = await this.#sourceSnapshot(input.root);
    const createdAt = this.#now();
    const artifactRow: DeploymentArtifactRow = {
      id: artifactId,
      buildId: input.buildId,
      targetId: input.target.id,
      projectId: input.projectId,
      version: input.spec.version,
      artifactHash: staged.hash,
      artifactPath,
      sizeBytes: staged.sizeBytes,
      fileCount: staged.fileCount,
      specJson: input.row.specJson,
      specHash: input.row.specHash,
      sourceJson: JSON.stringify(source),
      createdAt,
    };
    try {
      immediateTransaction(this.db, (tx) => {
        insertArtifact(tx, artifactRow);
        updateBuild(tx, input.buildId, {
          status: "SUCCEEDED",
          reasonCode: null,
          endedAt: createdAt,
        });
      });
    } catch (error) {
      try {
        await rm(artifactDirectory(this.#dataDir, artifactPath), {
          recursive: true,
          force: true,
        });
      } catch {
        /* The failed record remains authoritative. */
      }
      if (isUniqueConstraint(error)) {
        return this.#finishBuild(input.buildId, "FAILED", "VERSION_CONFLICT");
      }
      return this.#finishBuild(input.buildId, "FAILED", "DEPLOY_UNAVAILABLE");
    }

    return buildDto(this.#requireBuild(input.buildId));
  }

  #finishBuild(
    buildId: string,
    status: DeploymentBuildStatus,
    reasonCode: string | null,
  ): DeploymentBuildDto {
    updateBuild(this.db, buildId, { status, reasonCode, endedAt: this.#now() });
    return buildDto(this.#requireBuild(buildId));
  }

  #requireBuild(buildId: string): DeploymentBuildRow {
    const row = buildById(this.db, buildId);
    if (!row) throw new DeploymentError("DEPLOY_UNAVAILABLE", "Build record is missing");
    return row;
  }

  async #sourceSnapshot(root: string): Promise<DeploymentSource> {
    try {
      const [branch, commit, status] = await Promise.all([
        runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"], { readOnly: true, timeoutMs: 5000 }),
        runGit(root, ["rev-parse", "HEAD"], { readOnly: true, timeoutMs: 5000 }),
        runGit(root, ["status", "--porcelain"], { readOnly: true, timeoutMs: 5000 }),
      ]);
      return {
        branch: branch.stdout.trim() || null,
        commit: commit.stdout.trim() || null,
        dirty: status.stdout.trim() !== "",
      };
    } catch {
      return { branch: null, commit: null, dirty: null };
    }
  }

  getBuild(id: string): DeploymentBuildDto | null {
    const row = buildById(this.db, id);
    return row ? buildDto(row) : null;
  }

  artifactForBuild(buildId: string): DeploymentArtifactDto | null {
    const row = artifactByBuildId(this.db, buildId);
    return row ? artifactDto(row) : null;
  }

  async readBuildLog(buildId: string): Promise<string> {
    const row = this.#requireBuild(buildId);
    try {
      return await readDeploymentLog(this.#dataDir, row.logRef);
    } catch {
      throw new DeploymentError("DEPLOY_UNAVAILABLE", "Deployment log is unavailable");
    }
  }

  cancelBuild(buildId: string): boolean {
    const controller = this.#active.get(buildId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  recover(): number {
    const now = this.#now();
    const stale = runningBuilds(this.db);
    immediateTransaction(this.db, (tx) => {
      for (const row of stale) {
        updateBuild(tx, row.id, {
          status: "FAILED",
          reasonCode: "INTERRUPTED",
          endedAt: now,
        });
      }
    });
    for (const row of stale) {
      void removeStagedArtifact(this.#dataDir, row.id).catch(() => undefined);
    }
    return stale.length;
  }

  async verifyArtifact(artifactId: string): Promise<ArtifactVerification> {
    const row = artifactById(this.db, artifactId);
    if (!row) return { valid: false, code: "ARTIFACT_MISSING" };
    const result = await verifyStoredArtifact({
      dataDir: this.#dataDir,
      artifactPath: row.artifactPath,
      artifactId: row.id,
      targetId: row.targetId,
      expectedHash: row.artifactHash,
      limits: this.#limits,
    });
    return result.valid ? { valid: true } : { valid: false, code: result.code };
  }

  createPlan(input: CreatePlanInput): DeploymentPlanDto {
    const requestKey = assertText(input.requestKey, "request key", 256);
    const requestedBy = assertText(input.requestedBy, "requested by", 128);
    if (typeof input.artifactId !== "string") {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Invalid artifact");
    }
    const existing = planByRequestKey(this.db, requestKey);
    if (existing) {
      if (existing.artifactId !== input.artifactId) {
        throw new DeploymentError("DEPLOY_CONFLICT", "Request key belongs to another plan");
      }
      return planDto(existing);
    }

    const artifact = artifactById(this.db, input.artifactId);
    if (!artifact) {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact was not found");
    }
    const target = targetById(this.db, artifact.targetId);
    if (!target || target.projectId !== artifact.projectId) {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact target is invalid");
    }
    const project = getProjectById(this.db, artifact.projectId);
    if (!project) {
      throw new DeploymentError("DEPLOY_TARGET_INVALID", "Deployment project was not found");
    }
    if (
      input.expectedCurrentArtifactId !== undefined &&
      target.currentArtifactId !== input.expectedCurrentArtifactId
    ) {
      throw new DeploymentError("DEPLOY_CONFLICT", "Deployment target changed");
    }
    if (target.currentArtifactId === artifact.id && target.currentVersion === artifact.version) {
      throw new DeploymentError("DEPLOY_CONFLICT", "Plan would not change the deployment");
    }
    if (target.currentVersion === artifact.version) {
      throw new DeploymentError(
        "DEPLOY_CONFLICT",
        "Version is already deployed with another artifact",
      );
    }

    const spec = storedSpec(artifact);
    const source = storedSource(artifact);
    const expiresAt = this.#now() + DEPLOYMENT_PLAN_TTL_MS;
    const previousArtifactId =
      target.currentArtifactId as DeploymentPlanDocument["previousArtifactId"];
    const previousVersion = target.currentVersion as DeploymentVersion | null;
    const document: DeploymentPlanDocument = {
      version: 1,
      targetId: target.id as DeploymentPlanDocument["targetId"],
      projectId: target.projectId,
      artifactId: artifact.id as DeploymentPlanDocument["artifactId"],
      artifactHash: artifact.artifactHash,
      artifactVersion: artifact.version as DeploymentVersion,
      previousArtifactId,
      previousVersion,
      specHash: artifact.specHash,
      source,
      health: spec.health,
      recovery: {
        strategy: spec.recovery.strategy,
        maxAttempts: spec.recovery.maxAttempts,
        previousArtifactAvailable: previousArtifactId !== null,
        databaseRollback: "unsupported",
      },
      impact: {
        scope: "single-service",
        firstDeploy: previousArtifactId === null,
        restartRequired: true,
        downtime: "brief",
        replacesVersion: previousVersion,
        replacesArtifact: previousArtifactId,
      },
      expiresAt,
    };
    const parsed = DeploymentPlanDocumentSchema.parse(document);
    const planJson = canonicalJson(parsed);
    const planHash = sha256(planJson);
    const now = this.#now();
    const row: DeploymentPlanRow = {
      id: newId("plan"),
      targetId: target.id,
      projectId: target.projectId,
      artifactId: artifact.id,
      previousArtifactId,
      previousVersion,
      version: artifact.version,
      planJson,
      planHash,
      status: "READY",
      expiresAt,
      requestKey,
      requestedBy,
      createdAt: now,
    };
    try {
      immediateTransaction(this.db, (tx) => insertPlan(tx, row));
      return planDto(row);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const raced = planByRequestKey(this.db, requestKey);
      if (!raced || raced.artifactId !== artifact.id) {
        throw new DeploymentError("DEPLOY_CONFLICT", "Deployment plan conflict");
      }
      return planDto(raced);
    }
  }

  getPlan(planId: string): DeploymentPlanDto {
    const row = planById(this.db, planId);
    if (!row) throw new DeploymentError("DEPLOY_PLAN_INVALID", "Deployment plan was not found");
    if (row.status === "READY" && this.#now() >= row.expiresAt) {
      updatePlanStatus(this.db, row.id, "EXPIRED");
      return planDto(this.#requirePlan(row.id));
    }
    return planDto(row);
  }

  #requirePlan(planId: string): DeploymentPlanRow {
    const row = planById(this.db, planId);
    if (!row) throw new DeploymentError("DEPLOY_PLAN_INVALID", "Deployment plan is missing");
    return row;
  }

  async verifyPlan(planId: string): Promise<PlanVerification> {
    const row = planById(this.db, planId);
    if (!row) return { valid: false, code: "PLAN_NOT_FOUND" };
    if (row.status === "EXPIRED") return { valid: false, code: "PLAN_EXPIRED" };
    if (row.status !== "READY") return { valid: false, code: "PLAN_INVALID" };
    if (this.#now() >= row.expiresAt) {
      updatePlanStatus(this.db, row.id, "EXPIRED");
      return { valid: false, code: "PLAN_EXPIRED" };
    }
    let dto: DeploymentPlanDto;
    try {
      dto = planDto(row);
    } catch {
      return { valid: false, code: "PLAN_INVALID" };
    }
    if (sha256(canonicalJson(dto.plan)) !== row.planHash) {
      return { valid: false, code: "PLAN_INVALID" };
    }
    if (
      dto.plan.targetId !== row.targetId ||
      dto.plan.artifactId !== row.artifactId ||
      dto.plan.artifactVersion !== row.version ||
      dto.plan.previousArtifactId !== row.previousArtifactId ||
      dto.plan.previousVersion !== row.previousVersion ||
      dto.plan.expiresAt !== row.expiresAt
    ) {
      return { valid: false, code: "PLAN_INVALID" };
    }
    const target = targetById(this.db, row.targetId);
    if (
      !target ||
      target.projectId !== row.projectId ||
      target.currentArtifactId !== row.previousArtifactId ||
      target.currentVersion !== row.previousVersion
    ) {
      return { valid: false, code: "PLAN_STALE" };
    }
    const artifact = artifactById(this.db, row.artifactId);
    if (
      !artifact ||
      artifact.targetId !== target.id ||
      artifact.projectId !== row.projectId ||
      artifact.version !== dto.plan.artifactVersion ||
      artifact.artifactHash !== dto.plan.artifactHash ||
      artifact.specHash !== dto.plan.specHash
    ) {
      return { valid: false, code: "PLAN_INVALID" };
    }
    const verified = await this.verifyArtifact(artifact.id);
    if (!verified.valid) {
      return { valid: false, code: verified.code };
    }
    return { valid: true };
  }
}
