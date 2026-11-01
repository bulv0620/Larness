import { randomUUID } from "node:crypto";
import { chmodSync, renameSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import {
  type AppConfig,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  deriveWebAuthn,
  OriginUrlSchema,
  type UpdateChannel,
  type WebAuthnRuntime,
} from "@larness/shared";
import { hash as argon2Hash } from "@node-rs/argon2";
import { configFilePath } from "../bootstrap/config.js";
import type { Database } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import { createAuthSettings, getAuthSettings } from "../db/repositories/auth-settings.js";
import { getMeta, setMeta } from "../db/repositories/meta.js";
import { immediateTransaction } from "../db/transaction.js";
import { validateAdminPassword } from "./password.js";

export type InitErrorCode = "VALIDATION_ERROR" | "ALREADY_INITIALIZED" | "INTERNAL";

export class InitError extends Error {
  readonly code: InitErrorCode;

  constructor(code: InitErrorCode, message: string) {
    super(message);
    this.name = "InitError";
    this.code = code;
  }
}

export interface InitInput {
  adminPassword: string;
  host: string;
  port: number;
  publicUrl: string | null;
  channel?: UpdateChannel;
}

export interface InitConfigPlan {
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
}

export interface InitResult {
  origin: string;
  rpId: string;
  restartRequired: boolean;
}

export interface ApplyInitOptions {
  db: Database;
  dataDir: string;
  input: InitInput;
  currentConfig?: AppConfig;
  now?: number;
  hashPassword?: (password: string) => Promise<string>;
}

export function buildInitConfig(input: InitInput): InitConfigPlan {
  const passwordError = validateAdminPassword(input.adminPassword);

  if (passwordError !== null) {
    throw new InitError("VALIDATION_ERROR", passwordError);
  }

  const config = structuredClone(DEFAULT_APP_CONFIG);
  config.server.host = input.host;
  config.server.port = input.port;
  config.updates.channel = input.channel ?? config.updates.channel;

  if (input.publicUrl !== null && input.publicUrl.trim() !== "") {
    const candidate = input.publicUrl.trim();
    const parsed = OriginUrlSchema.safeParse(candidate);

    if (!parsed.success) {
      throw new InitError("VALIDATION_ERROR", "publicUrl must be an http(s) origin");
    }

    config.server.publicUrl = new URL(parsed.data).origin;
  } else {
    config.server.publicUrl = null;
  }

  const webAuthn = deriveWebAuthn(config.server, config.webauthn.rpName);
  config.webauthn = {
    rpId: webAuthn.rpId,
    rpName: webAuthn.rpName,
    origin: webAuthn.origin,
  };

  const validated = AppConfigSchema.safeParse(config);

  if (!validated.success) {
    const message = validated.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new InitError("VALIDATION_ERROR", message);
  }

  return { config: validated.data, webAuthn };
}

function restartRequired(next: AppConfig, current: AppConfig | undefined): boolean {
  if (current === undefined) {
    return true;
  }

  return (
    next.server.host !== current.server.host ||
    next.server.port !== current.server.port ||
    next.server.publicUrl !== current.server.publicUrl ||
    next.updates.channel !== current.updates.channel
  );
}

export async function applyInit(options: ApplyInitOptions): Promise<InitResult> {
  const now = options.now ?? Date.now();
  const plan = buildInitConfig(options.input);
  // Argon2id is the library default; keep it explicit in docs/tests rather than the const enum.
  const hashPassword = options.hashPassword ?? ((password: string) => argon2Hash(password));
  const adminHash = await hashPassword(options.input.adminPassword);
  const target = configFilePath(options.dataDir);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;

  await writeFile(temporary, `${JSON.stringify(plan.config, null, 2)}\n`, { mode: 0o600 });

  try {
    immediateTransaction(options.db, (tx) => {
      if (getAuthSettings(tx) !== null || getMeta(tx, "initialized_at") !== null) {
        throw new InitError("ALREADY_INITIALIZED", "this workspace is already initialized");
      }

      createAuthSettings(tx, {
        adminHash,
        initializedAt: now,
        now,
      });
      setMeta(tx, "initialized_at", String(now), now);
      appendAudit(tx, {
        action: "auth.init",
        decision: "allow",
        resourceType: "workspace",
        details: {
          origin: plan.webAuthn.origin,
          rpId: plan.webAuthn.rpId,
          host: plan.config.server.host,
          port: plan.config.server.port,
          channel: plan.config.updates.channel,
        },
        now,
      });

      renameSync(temporary, target);

      if (process.platform !== "win32") {
        chmodSync(target, 0o600);
      }
    });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);

    if (error instanceof InitError) {
      throw error;
    }

    throw new InitError(
      "INTERNAL",
      error instanceof Error ? error.message : "initialization failed",
    );
  }

  return {
    origin: plan.webAuthn.origin,
    rpId: plan.webAuthn.rpId,
    restartRequired: restartRequired(plan.config, options.currentConfig),
  };
}
