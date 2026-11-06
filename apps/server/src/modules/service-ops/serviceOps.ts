import { chmod, lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalDirectory, isInsideRoot } from "@larness/resources";
import {
  type DeploymentAuthorizationDto,
  type DeploymentSpec,
  DeploymentSpecSchema,
  type ServiceOpsDeploymentDto,
  type ServiceOpsEventPayload,
  type ServiceOpsObservedState,
  type ServiceOpsServiceDto,
} from "@larness/shared";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { DeploymentArtifactRow, DeploymentTargetRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { acquireResourceLock, releaseResourceLock, renewResourceLock } from "../locks/service.js";
import type { ResourceEventBus } from "../resources/events.js";
import { appendResourceEvent } from "../resources/repository.js";
import type { DeploymentAuthorizationService } from "./authorization.js";
import type { DeploymentManager } from "./deployments.js";
import { DeploymentError } from "./errors.js";
import type { Pm2Adapter } from "./pm2.js";
import {
  artifactById,
  setTargetCurrent,
  storedSpec,
  targetById,
  updatePlanStatus as updateDeploymentPlanStatus,
} from "./repository.js";
import {
  deploymentOpsByAuthorization,
  deploymentOpsById,
  deploymentOpsByPlan,
  deploymentOpsDto,
  insertDeploymentOps,
  insertServiceOpsRow,
  listDeploymentOps,
  listServiceOpsRows,
  serviceOpsDto,
  serviceOpsRow,
  updateDeploymentOps,
  updateServiceOpsRow,
} from "./serviceOpsRepository.js";
import { artifactDirectory, deploymentArtifactRoot, deploymentLogRoot } from "./storage.js";

const SERVICE_NAMESPACE = "larness";
const LOCK_TTL_MS = 60_000;
const LOCK_RENEW_MS = 20_000;

const StoredConfigSchema = z.strictObject({
  spec: DeploymentSpecSchema,
  pm2Name: z.string().min(1).max(128),
});

export interface ServiceOpsRuntimeOptions {
  db: Database;
  dataDir: string;
  deployments: DeploymentManager;
  authorizations: DeploymentAuthorizationService;
  pm2: Pm2Adapter | null;
  events: ResourceEventBus;
  now?: () => number;
}

export interface ApplyDeploymentInput {
  planId: string;
  authorizationId: string;
  consumeKey: string;
  context: unknown;
}

export interface ServiceOpsLogs {
  text: string;
  cursor: number;
  truncated: boolean;
}

function pm2Name(targetId: string): string {
  return `larness-${targetId}`;
}

function isNode(executable: string): boolean {
  return executable === process.execPath || path.basename(executable) === "node";
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new DeploymentError("DEPLOY_SPEC_INVALID", `Invalid ${field}`);
  }
  return value;
}

async function privateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new DeploymentError("DEPLOY_UNAVAILABLE", "Service operations storage is unavailable");
  }
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
}

export class ServiceOpsRuntime {
  readonly #db: Database;
  readonly #dataDir: string;
  readonly #deployments: DeploymentManager;
  readonly #authorizations: DeploymentAuthorizationService;
  readonly #pm2: Pm2Adapter | null;
  readonly #events: ResourceEventBus;
  readonly #now: () => number;

  constructor(options: ServiceOpsRuntimeOptions) {
    this.#db = options.db;
    this.#dataDir = options.dataDir;
    this.#deployments = options.deployments;
    this.#authorizations = options.authorizations;
    this.#pm2 = options.pm2;
    this.#events = options.events;
    this.#now = options.now ?? Date.now;
  }

  available(): boolean {
    return this.#pm2 !== null;
  }

  listServices(): ServiceOpsServiceDto[] {
    return listServiceOpsRows(this.#db).map((row) => this.#serviceDto(row));
  }

  getService(targetId: string): ServiceOpsServiceDto {
    const row = serviceOpsRow(this.#db, targetId);
    if (!row) throw new DeploymentError("NOT_FOUND", "Formal service was not found");
    return this.#serviceDto(row);
  }

  listDeployments(targetId: string): ServiceOpsDeploymentDto[] {
    return listDeploymentOps(this.#db, targetId).map(deploymentOpsDto);
  }

  async logs(targetId: string): Promise<ServiceOpsLogs> {
    const row = serviceOpsRow(this.#db, targetId);
    if (!row) throw new DeploymentError("NOT_FOUND", "Formal service was not found");
    const file = this.#logPath(targetId);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > 1024 * 1024) {
        throw new DeploymentError("DEPLOY_UNAVAILABLE", "Service log is unavailable");
      }
      return {
        text: await readFile(file, "utf8"),
        cursor: info.size,
        truncated: info.size >= 1024 * 1024,
      };
    } catch (error) {
      if (error instanceof DeploymentError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { text: "", cursor: 0, truncated: false };
      }
      throw new DeploymentError("DEPLOY_UNAVAILABLE", "Service log is unavailable");
    }
  }

  async apply(input: ApplyDeploymentInput): Promise<ServiceOpsDeploymentDto> {
    const planId = text(input.planId, "plan", 128);
    const authorizationId = text(input.authorizationId, "authorization", 128);
    const consumeKey = text(input.consumeKey, "consume key", 256);
    const existing = deploymentOpsByPlan(this.#db, planId);
    if (existing) {
      if (existing.status === "APPLYING" || existing.status === "HEALTH_CHECK") {
        throw new DeploymentError("DEPLOY_CONFLICT", "Deployment is already in progress");
      }
      return deploymentOpsDto(existing);
    }
    if (deploymentOpsByAuthorization(this.#db, authorizationId)) {
      throw new DeploymentError("DEPLOY_CONFLICT", "Authorization already has a deployment");
    }
    const plan = this.#deployments.getPlan(planId);
    if (plan.status !== "READY") {
      throw new DeploymentError(
        plan.status === "EXPIRED" ? "DEPLOY_PLAN_EXPIRED" : "DEPLOY_PLAN_INVALID",
        "Deployment plan is not ready",
      );
    }

    const verified = await this.#deployments.verifyPlan(planId);
    if (!verified.valid) {
      throw new DeploymentError(
        verified.code === "PLAN_EXPIRED" ? "DEPLOY_PLAN_EXPIRED" : "DEPLOY_PLAN_INVALID",
        "Deployment plan is no longer valid",
      );
    }
    const artifact = artifactById(this.#db, plan.artifactId);
    if (!artifact) throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact was not found");
    const target = targetById(this.#db, plan.targetId);
    if (!target)
      throw new DeploymentError("DEPLOY_TARGET_INVALID", "Deployment target was not found");
    const artifactVerification = await this.#deployments.verifyArtifact(artifact.id);
    if (!artifactVerification.valid) {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact is not valid");
    }

    const deploymentId = newId("dep");
    const lock = acquireResourceLock(
      { db: this.#db, now: this.#now },
      {
        resourceType: "service",
        resourceId: target.id,
        owner: "service-ops",
        executionId: deploymentId,
        ttlMs: LOCK_TTL_MS,
      },
    );
    if (!lock) throw new DeploymentError("RESOURCE_LOCKED", "Formal service is busy");

    let authorization: DeploymentAuthorizationDto;
    try {
      authorization = await this.#authorizations.consumeAuthorization({
        authorizationId,
        requestKey: consumeKey,
        context: input.context,
      });
    } catch (error) {
      releaseResourceLock(
        { db: this.#db, now: this.#now },
        { id: lock.id, fencingToken: lock.fencingToken },
      );
      throw error;
    }
    if (
      authorization.projectId !== plan.projectId ||
      authorization.targetId !== plan.targetId ||
      authorization.planId !== plan.id ||
      authorization.planHash !== plan.planHash
    ) {
      releaseResourceLock(
        { db: this.#db, now: this.#now },
        { id: lock.id, fencingToken: lock.fencingToken },
      );
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Authorization does not match plan");
    }

    const now = this.#now();
    const service = this.#ensureService(target, plan, artifact, now);
    const deploymentRow = {
      id: deploymentId,
      targetId: target.id,
      projectId: target.projectId,
      planId: plan.id,
      authorizationId,
      artifactId: artifact.id,
      previousArtifactId: plan.previousArtifactId,
      previousVersion: plan.previousVersion,
      version: artifact.version,
      status: "APPLYING" as const,
      planHash: plan.planHash,
      artifactHash: artifact.artifactHash,
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      policy: authorization.policy,
      policySnapshotId: authorization.policySnapshotId,
      reasonCode: null,
      healthJson: null,
      resultJson: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
    };
    immediateTransaction(this.#db, (tx) => {
      insertDeploymentOps(tx, deploymentRow);
      updateDeploymentPlanStatus(tx, plan.id, "APPLYING");
    });

    let lost = false;
    const renew = setInterval(() => {
      const renewed = renewResourceLock(
        { db: this.#db, now: this.#now },
        { id: lock.id, fencingToken: lock.fencingToken, ttlMs: LOCK_TTL_MS },
      );
      if (!renewed) lost = true;
    }, LOCK_RENEW_MS);
    renew.unref();

    try {
      if (this.#pm2 === null) {
        return this.#fail(target, deploymentId, "PM2_UNAVAILABLE", now, service);
      }
      const spec = storedSpec(artifact);
      const config = await this.#writeConfig(target, artifact, spec);
      if (!(await this.#pm2.start(config.configPath, config.pm2Name))) {
        return plan.previousArtifactId
          ? await this.#rollback(target, deploymentId, plan, now, service, "START_FAILED")
          : this.#fail(target, deploymentId, "START_FAILED", now, service);
      }
      this.#setDeployment(deploymentId, "HEALTH_CHECK", null);
      updateDeploymentPlanStatus(this.#db, plan.id, "HEALTH_CHECK");
      if (lost) return this.#fail(target, deploymentId, "LOCK_LOST", now, service);
      const identity = await this.#appIdentity(config);
      if (!identity) {
        return plan.previousArtifactId
          ? await this.#rollback(target, deploymentId, plan, now, service, "IDENTITY_MISMATCH")
          : this.#fail(target, deploymentId, "IDENTITY_MISMATCH", now, service);
      }
      const healthy = await this.#health(spec.health);
      if (lost) return this.#fail(target, deploymentId, "LOCK_LOST", now, service);
      if (healthy) {
        return this.#succeed(target, artifact, config, deploymentId, now, service, identity.pid);
      }
      return await this.#rollback(target, deploymentId, plan, now, service, "HEALTH_FAILED");
    } catch (error) {
      const reason = error instanceof DeploymentError ? error.code : "DEPLOY_UNAVAILABLE";
      return plan.previousArtifactId
        ? await this.#rollback(target, deploymentId, plan, this.#now(), service, reason)
        : this.#fail(target, deploymentId, reason, this.#now(), service);
    } finally {
      clearInterval(renew);
      releaseResourceLock(
        { db: this.#db, now: this.#now },
        { id: lock.id, fencingToken: lock.fencingToken },
      );
    }
  }

  async reconcile(): Promise<number> {
    let changed = 0;
    for (const row of listServiceOpsRows(this.#db)) {
      const config = this.#parseConfig(row.configJson);
      let observed: ServiceOpsObservedState;
      let pid: number | null = null;
      let reason: string | null = null;
      if (this.#pm2 === null) {
        observed = "unknown";
        reason = "PM2_UNAVAILABLE";
      } else {
        const app = await this.#pm2.find(row.pm2Name);
        if (app === "unknown") {
          observed = "unknown";
          reason = "PM2_UNKNOWN";
        } else if (app === "missing") {
          observed = row.desiredState === "running" ? "failed" : "stopped";
          reason = row.desiredState === "running" ? "PM2_MISSING" : null;
        } else if (app.status !== "online") {
          observed = row.desiredState === "running" ? "failed" : "stopped";
          reason = app.status.toUpperCase();
        } else {
          pid = app.pid ?? null;
          const healthy = config ? await this.#health(config.spec.health) : false;
          observed = healthy ? "running" : "unhealthy";
          reason = healthy ? null : "HEALTH_FAILED";
        }
      }
      if (observed === row.observedState && pid === row.pid && reason === row.reasonCode) continue;
      const now = this.#now();
      immediateTransaction(this.#db, (tx) => {
        updateServiceOpsRow(tx, row.targetId, {
          observedState: observed,
          pid,
          reasonCode: reason,
          lastHealthAt: observed === "running" ? now : row.lastHealthAt,
          updatedAt: now,
        });
      });
      this.#emit(row.targetId, {
        observedState: observed,
        desiredState: row.desiredState,
        version: row.currentVersion as ServiceOpsEventPayload["version"],
        artifactHash: null,
        pid,
        deploymentId: null,
        reasonCode: reason,
      });
      changed += 1;
    }
    return changed;
  }

  #ensureService(
    target: DeploymentTargetRow,
    plan: ReturnType<DeploymentManager["getPlan"]>,
    artifact: DeploymentArtifactRow,
    now: number,
  ): { targetId: string; pm2Name: string } {
    const existing = serviceOpsRow(this.#db, target.id);
    const name = pm2Name(target.id);
    if (existing) return { targetId: existing.targetId, pm2Name: existing.pm2Name };
    const previous = plan.previousArtifactId
      ? artifactById(this.#db, plan.previousArtifactId)
      : null;
    const initialSpec = previous ? storedSpec(previous) : storedSpec(artifact);
    const configJson = JSON.stringify({ spec: initialSpec, pm2Name: name });
    immediateTransaction(this.#db, (tx) => {
      insertServiceOpsRow(tx, {
        targetId: target.id,
        projectId: target.projectId,
        name: target.name,
        namespace: SERVICE_NAMESPACE,
        pm2Name: name,
        desiredState: "running",
        observedState: "starting",
        currentArtifactId: target.currentArtifactId,
        currentVersion: target.currentVersion,
        configJson,
        pid: null,
        lastHealthAt: null,
        reasonCode: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    void plan;
    return { targetId: target.id, pm2Name: name };
  }

  #parseConfig(json: string): z.infer<typeof StoredConfigSchema> | null {
    try {
      return StoredConfigSchema.parse(JSON.parse(json));
    } catch {
      return null;
    }
  }

  #serviceDto(row: ReturnType<typeof serviceOpsRow>): ServiceOpsServiceDto {
    if (!row) throw new DeploymentError("NOT_FOUND", "Formal service was not found");
    const dto = serviceOpsDto(row);
    const artifact = row.currentArtifactId ? artifactById(this.#db, row.currentArtifactId) : null;
    return { ...dto, artifactHash: artifact?.artifactHash ?? null };
  }

  async #writeConfig(
    target: DeploymentTargetRow,
    artifact: DeploymentArtifactRow,
    spec: DeploymentSpec,
  ): Promise<{
    configPath: string;
    pm2Name: string;
    logPath: string;
    cwd: string;
    script: string;
    interpreter: string;
    args: string[];
  }> {
    const name = pm2Name(target.id);
    const root = await realpath(deploymentArtifactRoot(this.#dataDir)).catch(() => {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact storage is unavailable");
    });
    const artifactRoot = artifactDirectory(this.#dataDir, artifact.artifactPath);
    const payload = path.join(artifactRoot, "payload");
    const realPayload = await realpath(payload).catch(() => {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact payload is unavailable");
    });
    if (!isInsideRoot(root, realPayload)) {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact payload is outside storage");
    }
    const cwd = await canonicalDirectory(path.resolve(realPayload, spec.start.cwd)).catch(() => {
      throw new DeploymentError("DEPLOY_SPEC_INVALID", "Start directory is unavailable");
    });
    if (!isInsideRoot(realPayload, cwd)) {
      throw new DeploymentError("DEPLOY_SPEC_INVALID", "Start directory is outside the artifact");
    }

    const [executable, ...commandArgs] = spec.start.command;
    let interpreter: string;
    let script: string;
    let args: string[];
    let nodeArgs: string[] = [];
    if (isNode(executable)) {
      let index = 0;
      while (index < commandArgs.length && commandArgs[index]?.startsWith("-")) index += 1;
      const entry = commandArgs[index];
      if (!entry) throw new DeploymentError("DEPLOY_SPEC_INVALID", "Missing Node entry file");
      interpreter = executable;
      script = entry;
      args = commandArgs.slice(index + 1);
      nodeArgs = commandArgs.slice(0, index);
    } else if (/\.(?:c|m)?js$/.test(executable)) {
      interpreter = process.execPath;
      script = executable;
      args = commandArgs;
    } else {
      throw new DeploymentError(
        "DEPLOY_SPEC_INVALID",
        "PM2 services require a Node.js entry command",
      );
    }
    const scriptPath = path.isAbsolute(script) ? script : path.resolve(cwd, script);
    const realScript = await realpath(scriptPath).catch(() => {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Service entry file is unavailable");
    });
    if (!isInsideRoot(realPayload, realScript)) {
      throw new DeploymentError(
        "DEPLOY_SPEC_INVALID",
        "Service entry file is outside the artifact",
      );
    }

    const logDir = deploymentLogRoot(this.#dataDir);
    await privateDirectory(logDir);
    const logPath = path.join(logDir, `${target.id}.log`);
    const configDir = path.join(this.#dataDir, "service-ops", target.id);
    await privateDirectory(configDir);
    const configPath = path.join(configDir, "ecosystem.config.cjs");
    try {
      const existing = await lstat(configPath);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new DeploymentError("DEPLOY_UNAVAILABLE", "Service configuration is unavailable");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const app = {
      name,
      namespace: SERVICE_NAMESPACE,
      script: realScript,
      args,
      ...(nodeArgs.length ? { node_args: nodeArgs.join(" ") } : {}),
      cwd,
      interpreter,
      env: {
        PORT: String(spec.health.port),
        NODE_ENV: "production",
      },
      autorestart: true,
      out_file: logPath,
      error_file: logPath,
      merge_logs: true,
      time: true,
      max_restarts: 10,
      min_uptime: "5s",
      kill_timeout: 5_000,
    };
    const temporary = `${configPath}.${newId("tmp")}.tmp`;
    await writeFile(temporary, `module.exports = ${JSON.stringify({ apps: [app] })};\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, configPath);
    await chmod(configPath, 0o600);
    return {
      configPath,
      pm2Name: name,
      logPath,
      cwd,
      script: realScript,
      interpreter,
      args,
    };
  }

  async #appIdentity(config: {
    pm2Name: string;
    cwd: string;
    script: string;
    interpreter: string;
    args: string[];
  }): Promise<{ pid: number } | null> {
    if (this.#pm2 === null) return null;
    const app = await this.#pm2.find(config.pm2Name);
    if (typeof app === "string" || !app.pid) return null;
    if (
      app.namespace !== SERVICE_NAMESPACE ||
      app.status !== "online" ||
      app.cwd !== config.cwd ||
      app.entry !== config.script ||
      app.interpreter !== config.interpreter ||
      JSON.stringify(app.args ?? []) !== JSON.stringify(config.args)
    ) {
      return null;
    }
    return { pid: app.pid };
  }

  async #health(health: DeploymentSpec["health"]): Promise<boolean> {
    const deadline = Date.now() + health.timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${health.port}${health.path}`, {
          signal: AbortSignal.timeout(Math.min(health.intervalMs * 4, 2_000)),
          redirect: "error",
        });
        await response.arrayBuffer();
        if (response.ok) return true;
      } catch {
        /* The process and its HTTP health are separate observations. */
      }
      await delay(health.intervalMs);
    }
    return false;
  }

  #setDeployment(
    id: string,
    status: "APPLYING" | "HEALTH_CHECK" | "SUCCEEDED" | "FAILED" | "UNKNOWN",
    reasonCode: string | null,
  ): void {
    updateDeploymentOps(this.#db, id, { status, reasonCode });
  }

  #succeed(
    target: DeploymentTargetRow,
    artifact: DeploymentArtifactRow,
    config: {
      pm2Name: string;
      logPath: string;
      cwd: string;
      script: string;
      interpreter: string;
      args: string[];
    },
    deploymentId: string,
    now: number,
    _service: { targetId: string; pm2Name: string },
    pid: number,
  ): ServiceOpsDeploymentDto {
    const spec = storedSpec(artifact);
    const configJson = JSON.stringify({ spec, pm2Name: config.pm2Name });
    const planId = this.#requireDeployment(deploymentId).planId;
    const event = immediateTransaction(this.#db, (tx) => {
      updateDeploymentOps(tx, deploymentId, {
        status: "SUCCEEDED",
        reasonCode: null,
        endedAt: now,
        healthJson: JSON.stringify({ ok: true, checkedAt: now }),
      });
      updateServiceOpsRow(tx, target.id, {
        observedState: "running",
        currentArtifactId: artifact.id,
        currentVersion: artifact.version,
        configJson,
        pid,
        lastHealthAt: now,
        reasonCode: null,
        updatedAt: now,
      });
      setTargetCurrent(tx, target.id, {
        artifactId: artifact.id,
        version: artifact.version,
        updatedAt: now,
      });
      updateDeploymentPlanStatus(tx, planId, "SUCCEEDED");
      appendAudit(tx, {
        action: "deployment.apply.succeeded",
        decision: "allow",
        resourceType: "deployment",
        resourceId: deploymentId,
        details: {
          targetId: target.id,
          planId,
          version: artifact.version,
          artifactHash: artifact.artifactHash,
        },
        now,
      });
      return appendResourceEvent(
        tx,
        `ops:${target.id}`,
        "service-ops.deployment",
        {
          observedState: "running",
          desiredState: "running",
          version: artifact.version,
          artifactHash: artifact.artifactHash,
          pid,
          deploymentId,
          reasonCode: null,
        } satisfies ServiceOpsEventPayload,
        now,
      );
    });
    this.#events.publish(event);
    return deploymentOpsDto(this.#requireDeployment(deploymentId));
  }

  async #rollback(
    target: DeploymentTargetRow,
    deploymentId: string,
    plan: ReturnType<DeploymentManager["getPlan"]>,
    now: number,
    service: { targetId: string; pm2Name: string },
    failureCode: string,
  ): Promise<ServiceOpsDeploymentDto> {
    const previousArtifact = plan.previousArtifactId
      ? artifactById(this.#db, plan.previousArtifactId)
      : null;
    let rolledBack = false;
    let rolledBackPid: number | null = null;
    if (previousArtifact && this.#pm2 !== null) {
      try {
        const previousSpec = storedSpec(previousArtifact);
        const config = await this.#writeConfig(target, previousArtifact, previousSpec);
        const identity = (await this.#pm2.start(config.configPath, config.pm2Name))
          ? await this.#appIdentity(config)
          : null;
        if (identity && (await this.#health(previousSpec.health))) {
          rolledBack = true;
          rolledBackPid = identity.pid;
          const configJson = JSON.stringify({ spec: previousSpec, pm2Name: config.pm2Name });
          immediateTransaction(this.#db, (tx) => {
            updateServiceOpsRow(tx, target.id, {
              observedState: "running",
              currentArtifactId: previousArtifact.id,
              currentVersion: previousArtifact.version,
              configJson,
              pid: identity.pid,
              lastHealthAt: now,
              reasonCode: `${failureCode}_ROLLED_BACK`,
              updatedAt: now,
            });
          });
        }
      } catch {
        rolledBack = false;
      }
    }
    if (!rolledBack && this.#pm2 !== null) {
      await this.#pm2.stop(service.pm2Name).catch(() => false);
    }
    const reason = rolledBack ? `${failureCode}_ROLLED_BACK` : failureCode;
    const event = immediateTransaction(this.#db, (tx) => {
      updateDeploymentOps(tx, deploymentId, {
        status: "FAILED",
        reasonCode: reason,
        endedAt: now,
        healthJson: JSON.stringify({ ok: false, checkedAt: now }),
        resultJson: JSON.stringify({ rolledBack }),
      });
      updateServiceOpsRow(tx, target.id, {
        observedState: rolledBack ? "running" : "failed",
        pid: rolledBackPid,
        reasonCode: reason,
        updatedAt: now,
      });
      updateDeploymentPlanStatus(tx, plan.id, "FAILED");
      appendAudit(tx, {
        action: "deployment.apply.failed",
        decision: "deny",
        resourceType: "deployment",
        resourceId: deploymentId,
        details: { targetId: target.id, reason, rolledBack },
        now,
      });
      return appendResourceEvent(
        tx,
        `ops:${target.id}`,
        "service-ops.status",
        {
          observedState: rolledBack ? "running" : "failed",
          desiredState: "running",
          version: rolledBack ? (plan.previousVersion as string | null) : plan.version,
          artifactHash: rolledBack
            ? (previousArtifact?.artifactHash ?? null)
            : plan.plan.artifactHash,
          pid: rolledBackPid,
          deploymentId,
          reasonCode: reason,
        } satisfies ServiceOpsEventPayload,
        now,
      );
    });
    this.#events.publish(event);
    return deploymentOpsDto(this.#requireDeployment(deploymentId));
  }

  #fail(
    target: DeploymentTargetRow,
    deploymentId: string,
    reasonCode: string,
    now: number,
    service: { targetId: string; pm2Name: string },
  ): ServiceOpsDeploymentDto {
    const event = immediateTransaction(this.#db, (tx) => {
      const observedState = serviceOpsRow(tx, target.id)?.currentVersion ? "unknown" : "failed";
      updateDeploymentOps(tx, deploymentId, {
        status: "FAILED",
        reasonCode,
        endedAt: now,
      });
      updateServiceOpsRow(tx, target.id, {
        observedState,
        reasonCode,
        updatedAt: now,
      });
      const failedDeployment = deploymentOpsById(tx, deploymentId);
      if (failedDeployment) updateDeploymentPlanStatus(tx, failedDeployment.planId, "FAILED");
      appendAudit(tx, {
        action: "deployment.apply.failed",
        decision: "deny",
        resourceType: "deployment",
        resourceId: deploymentId,
        details: { targetId: target.id, reasonCode },
        now,
      });
      return appendResourceEvent(
        tx,
        `ops:${target.id}`,
        "service-ops.status",
        {
          observedState,
          desiredState: "running",
          version: null,
          artifactHash: null,
          pid: null,
          deploymentId,
          reasonCode,
        } satisfies ServiceOpsEventPayload,
        now,
      );
    });
    this.#events.publish(event);
    void service;
    return deploymentOpsDto(this.#requireDeployment(deploymentId));
  }

  #emit(targetId: string, payload: ServiceOpsEventPayload): void {
    const now = this.#now();
    const row = immediateTransaction(this.#db, (tx) =>
      appendResourceEvent(tx, `ops:${targetId}`, "service-ops.status", payload, now),
    );
    this.#events.publish(row);
  }

  #requireDeployment(id: string): import("../../db/schema.js").ServiceOpsDeploymentRow {
    const row = deploymentOpsById(this.#db, id);
    if (!row) throw new DeploymentError("DEPLOY_UNAVAILABLE", "Deployment record is missing");
    return row;
  }

  #logPath(targetId: string): string {
    return path.join(deploymentLogRoot(this.#dataDir), `${targetId}.log`);
  }
}
