import { z } from "zod";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export const UPDATE_CHANNELS = ["stable", "beta"] as const;

export const LogLevelSchema = z.enum(LOG_LEVELS);
export const UpdateChannelSchema = z.enum(UPDATE_CHANNELS);

export function isOriginUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

export const OriginUrlSchema = z
  .string()
  .max(2048)
  .refine(isOriginUrl, "must be an http(s) origin without path, query or credentials");

export const ServerConfigSchema = z.strictObject({
  host: z.string().min(1).max(255),
  port: z.int().min(1).max(65535),
  publicUrl: OriginUrlSchema.nullable(),
  trustedProxies: z.array(z.string().min(1)).max(64),
});

export const AuthConfigSchema = z.strictObject({
  sessionTtlMinutes: z.int().min(1).max(43_200),
  idleTtlMinutes: z.int().min(1).max(43_200),
  requireHttpsForRemote: z.boolean(),
});

export const WebAuthnConfigSchema = z.strictObject({
  rpId: z.string().min(1).max(253),
  rpName: z.string().min(1).max(128),
  origin: OriginUrlSchema,
});

export const LoggingConfigSchema = z.strictObject({
  level: LogLevelSchema,
  retentionDays: z.int().min(1).max(3650),
});

export const UpdatesConfigSchema = z.strictObject({
  channel: UpdateChannelSchema,
  autoCheck: z.boolean(),
  autoInstall: z.boolean(),
});

export const PreviewConfigSchema = z.strictObject({
  enabled: z.boolean(),
});

export const AppConfigSchema = z.strictObject({
  version: z.literal(1),
  server: ServerConfigSchema,
  auth: AuthConfigSchema,
  webauthn: WebAuthnConfigSchema,
  logging: LoggingConfigSchema,
  updates: UpdatesConfigSchema,
  preview: PreviewConfigSchema,
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type WebAuthnConfig = z.infer<typeof WebAuthnConfigSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;
export type UpdatesConfig = z.infer<typeof UpdatesConfigSchema>;
export type PreviewConfig = z.infer<typeof PreviewConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const DEFAULT_APP_CONFIG: AppConfig = {
  version: 1,
  server: {
    host: "127.0.0.1",
    port: 3210,
    publicUrl: null,
    trustedProxies: [],
  },
  auth: {
    sessionTtlMinutes: 720,
    idleTtlMinutes: 30,
    requireHttpsForRemote: true,
  },
  webauthn: {
    rpId: "localhost",
    rpName: "Larness",
    origin: "http://localhost:3210",
  },
  logging: {
    level: "info",
    retentionDays: 14,
  },
  updates: {
    channel: "stable",
    autoCheck: true,
    autoInstall: false,
  },
  preview: {
    enabled: false,
  },
};

export type WebAuthnDisabledReason = "rp_id_is_ip" | "remote_http";

export interface WebAuthnRuntime {
  enabled: boolean;
  origin: string;
  rpId: string;
  rpName: string;
  reason: WebAuthnDisabledReason | null;
}

export function isIpHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }

  return host.includes(":") && /^[0-9a-f:]+$/i.test(host);
}

export function deriveWebAuthn(
  server: Pick<ServerConfig, "port" | "publicUrl">,
  rpName: string,
): WebAuthnRuntime {
  const url = new URL(server.publicUrl ?? `http://localhost:${server.port}`);
  const rpId = url.hostname;
  const reason: WebAuthnDisabledReason | null = isIpHostname(rpId)
    ? "rp_id_is_ip"
    : url.protocol === "http:" && rpId !== "localhost"
      ? "remote_http"
      : null;

  return {
    enabled: reason === null,
    origin: url.origin,
    rpId,
    rpName,
    reason,
  };
}
