export interface ServerConfig {
  host: string;
  port: number;
  publicUrl: string | null;
  trustedProxies: string[];
}

export interface AuthConfig {
  sessionTtlMinutes: number;
  idleTtlMinutes: number;
  requireHttpsForRemote: boolean;
}

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origin: string;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggingConfig {
  level: LogLevel;
  retentionDays: number;
}

export type UpdateChannel = "stable" | "beta";

export interface UpdatesConfig {
  channel: UpdateChannel;
  autoCheck: boolean;
  autoInstall: boolean;
}

export interface PreviewConfig {
  enabled: boolean;
}

export interface AppConfig {
  version: 1;
  server: ServerConfig;
  auth: AuthConfig;
  webauthn: WebAuthnConfig;
  logging: LoggingConfig;
  updates: UpdatesConfig;
  preview: PreviewConfig;
}
