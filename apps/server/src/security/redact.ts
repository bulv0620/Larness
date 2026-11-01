export const REDACT_CENSOR = "[Redacted]";

export const REDACT_PATHS = [
  "password",
  "*.password",
  "adminPassword",
  "*.adminPassword",
  "token",
  "*.token",
  "tokenHash",
  "*.tokenHash",
  "sessionToken",
  "*.sessionToken",
  "enrollmentToken",
  "*.enrollmentToken",
  "pollToken",
  "*.pollToken",
  "csrfToken",
  "*.csrfToken",
  "csrfKey",
  "*.csrfKey",
  "ipcToken",
  "*.ipcToken",
  "pairingCode",
  "*.pairingCode",
  "headers.cookie",
  "*.cookie",
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers['x-csrf-token']",
  "req.headers['x-pairing-token']",
  "res.headers['set-cookie']",
] as const;

export const REDACT_OPTIONS: { paths: string[]; censor: string; remove: boolean } = {
  paths: [...REDACT_PATHS],
  censor: REDACT_CENSOR,
  remove: false,
};
