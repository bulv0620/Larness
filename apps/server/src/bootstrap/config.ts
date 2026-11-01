import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type AppConfig,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  deriveWebAuthn,
  LogLevelSchema,
  OriginUrlSchema,
  type WebAuthnRuntime,
} from "@larness/shared";

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export interface LoadedConfig {
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  source: "file" | "defaults";
  path: string;
}

export interface LoadConfigOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
}

export function configFilePath(dataDir: string): string {
  return path.join(dataDir, "config.json");
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
}

function applyEnvOverrides(config: AppConfig, env: NodeJS.ProcessEnv): void {
  const host = env.LARNESS_HOST?.trim();
  if (host) {
    config.server.host = host;
  }

  const rawPort = env.LARNESS_PORT?.trim();
  if (rawPort) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigError(
        `LARNESS_PORT must be an integer between 1 and 65535, received "${rawPort}"`,
      );
    }
    config.server.port = port;
  }

  if (env.LARNESS_PUBLIC_URL !== undefined) {
    const value = env.LARNESS_PUBLIC_URL.trim();
    if (value === "") {
      config.server.publicUrl = null;
    } else {
      const parsed = OriginUrlSchema.safeParse(value);
      if (!parsed.success) {
        throw new ConfigError(`LARNESS_PUBLIC_URL must be an http(s) origin, received "${value}"`);
      }
      config.server.publicUrl = new URL(parsed.data).origin;
    }
  }

  const rawLevel = env.LARNESS_LOG_LEVEL?.trim();
  if (rawLevel) {
    const parsed = LogLevelSchema.safeParse(rawLevel);
    if (!parsed.success) {
      throw new ConfigError(
        `LARNESS_LOG_LEVEL must be one of: ${LogLevelSchema.options.join(", ")}`,
      );
    }
    config.logging.level = parsed.data;
  }
}

export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const file = configFilePath(options.dataDir);
  let raw: unknown;
  let source: LoadedConfig["source"] = "defaults";
  let text: string | null = null;

  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(
        `cannot read config.json at ${file}: ${(error as NodeJS.ErrnoException).code}`,
      );
    }
  }

  if (text !== null) {
    source = "file";
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ConfigError(`config.json is not valid JSON: ${file}`);
    }
  } else {
    raw = structuredClone(DEFAULT_APP_CONFIG);
  }

  const parsed = AppConfigSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = formatIssues(parsed.error.issues);
    throw new ConfigError(`invalid config.json: ${issues.join("; ")}`, issues);
  }

  const config = parsed.data;
  applyEnvOverrides(config, env);

  const validated = AppConfigSchema.safeParse(config);

  if (!validated.success) {
    const issues = formatIssues(validated.error.issues);
    throw new ConfigError(
      `invalid config after environment overrides: ${issues.join("; ")}`,
      issues,
    );
  }

  const webAuthn = deriveWebAuthn(validated.data.server, validated.data.webauthn.rpName);

  return {
    config: {
      ...validated.data,
      webauthn: {
        rpId: webAuthn.rpId,
        rpName: webAuthn.rpName,
        origin: webAuthn.origin,
      },
    },
    webAuthn,
    source,
    path: file,
  };
}
