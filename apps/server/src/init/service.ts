import { isDeepStrictEqual } from "node:util";
import {
  type AppConfig,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  deriveWebAuthn,
  OriginUrlSchema,
  type WebAuthnRuntime,
} from "@larness/shared";
import { loadConfig } from "../bootstrap/config.js";
import type { Database } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import { createAuthSettings, getAuthSettings } from "../db/repositories/auth-settings.js";
import { getMeta, setMeta } from "../db/repositories/meta.js";
import { immediateTransaction } from "../db/transaction.js";
import type { InitApplyParams } from "../ipc/protocol.js";
import { recoverInitialization } from "./recovery.js";

export type InitErrorCode = "VALIDATION_ERROR" | "ALREADY_INITIALIZED" | "INTERNAL";

export class InitError extends Error {
  readonly code: InitErrorCode;

  constructor(code: InitErrorCode, message: string) {
    super(message);
    this.name = "InitError";
    this.code = code;
  }
}

export type InitInput = InitApplyParams;

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
  env?: NodeJS.ProcessEnv;
}

export function buildInitConfig(
  input: InitInput,
  base: AppConfig = DEFAULT_APP_CONFIG,
): InitConfigPlan {
  const config = structuredClone(base);
  config.server.host = input.host ?? config.server.host;
  config.server.port = input.port ?? config.server.port;
  config.updates.channel = input.channel ?? config.updates.channel;

  if (input.publicUrl !== undefined && input.publicUrl !== null && input.publicUrl.trim() !== "") {
    const candidate = input.publicUrl.trim();
    const parsed = OriginUrlSchema.safeParse(candidate);

    if (!parsed.success) {
      throw new InitError("VALIDATION_ERROR", "publicUrl must be an http(s) origin");
    }

    config.server.publicUrl = new URL(parsed.data).origin;
  } else if (input.publicUrl !== undefined) {
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

  return !isDeepStrictEqual(next, current);
}

export async function applyInit(options: ApplyInitOptions): Promise<InitResult> {
  const now = options.now ?? Date.now();
  const baseline = await loadConfig({ dataDir: options.dataDir, env: {} });
  const plan = buildInitConfig(options.input, baseline.config);

  try {
    immediateTransaction(options.db, (tx) => {
      if (getAuthSettings(tx) !== null || getMeta(tx, "initialized_at") !== null) {
        throw new InitError("ALREADY_INITIALIZED", "this workspace is already initialized");
      }

      createAuthSettings(tx, {
        adminHash: "",
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

      setMeta(tx, "init_pending", JSON.stringify({ version: 1, config: plan.config }), now);
    });
    recoverInitialization(options.db, options.dataDir);
  } catch (error) {
    if (error instanceof InitError) {
      throw error;
    }

    throw new InitError(
      "INTERNAL",
      "initialization failed; restart Larness to recover the saved configuration",
    );
  }

  const effective = await loadConfig({ dataDir: options.dataDir, env: options.env });
  return {
    origin: effective.webAuthn.origin,
    rpId: effective.webAuthn.rpId,
    restartRequired: restartRequired(effective.config, options.currentConfig),
  };
}
