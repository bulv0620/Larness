export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export interface BootstrapData {
  app: { name: string; version: string };
  initialized: boolean;
  auth: {
    authenticated: boolean;
    pairingEnabled: boolean;
    passkeyEnabled: boolean;
    passkeyOrigin: string;
    passkeyRegistered: boolean;
  };
  features: { preview: boolean };
  serverTime: number;
}

export interface SessionData {
  clientSessionId: string;
  deviceId: string | null;
  kind: "once" | "passkey";
  createdAt: number;
  expiresAt: number;
  csrfToken: string;
  capabilities: string[];
  passkey?: { backupEligible: boolean; backupState: boolean };
}

export interface PairingCreated {
  requestId: string;
  shortCode: string;
  pollToken: string;
  expiresAt: number;
}

export interface PairingStatus {
  status: "pending" | "approved" | "enrollment_pending" | "denied" | "expired" | "redeemed";
  decision: "allow_once" | "trust" | null;
  expiresAt: number;
}

export interface RedeemSessionResponse {
  status: "session";
  clientSessionId: string;
  kind: "once";
  deviceId: null;
  csrfToken: string;
  expiresAt: number;
}

export interface RedeemEnrollmentResponse {
  status: "passkey_required";
  requestId: string;
  enrollmentExpiresAt: number;
}

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...options.headers,
  };

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (options.csrf) {
    headers["x-csrf-token"] = csrfToken ?? "";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let payload: unknown;

  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    const code = error?.code ?? "INTERNAL";
    const message = error?.message ?? `Request failed with ${response.status}`;

    if (response.status === 401 && path !== "/api/auth/session") {
      window.dispatchEvent(new Event("larness:unauthenticated"));
    }

    throw new ApiError(response.status, code, message, error?.details);
  }

  return payload as T;
}
