import type { MemoryScope } from "../../db/schema.js";

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  /\b(api[_-]?key|secret|token|password|cookie)\s*[:=]\s*\S{8,}/i,
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /disregard\s+(the\s+)?(system|safety)\s+(prompt|policy)/i,
  /allow\s+all\s+(commands|tools|permissions)/i,
  /disable\s+(the\s+)?(approval|security|safety)/i,
];

const HOME_PATH_PATTERNS: RegExp[] = [
  /(^|\s)\/(Users|home)\/[^\s]+/,
  /(^|\s)[A-Za-z]:\\Users\\[^\s]+/,
];

export type MemoryContentVerdict =
  | { ok: true }
  | { ok: false; code: "MEMORY_SECRET_REJECTED"; reason: string };

function shortPreference(body: string): boolean {
  const pathLike = /(^|\s)(~\/|\.{1,2}\/|\/[^\s]|[A-Za-z]:\\)/;
  return body.length <= 600 && !body.includes("```") && !pathLike.test(body);
}

/**
 * Content policy for durable memory. The goal is to keep credentials and
 * imperative prompt-injection text out of the persistent prompt, not to be a
 * complete DLP system.
 */
export function memoryContentVerdict(scope: MemoryScope, body: string): MemoryContentVerdict {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(body)) {
      return {
        ok: false,
        code: "MEMORY_SECRET_REJECTED",
        reason: "contains a credential-like value",
      };
    }
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(body)) {
      return {
        ok: false,
        code: "MEMORY_SECRET_REJECTED",
        reason: "contains imperative security instructions",
      };
    }
  }

  for (const pattern of HOME_PATH_PATTERNS) {
    if (pattern.test(body)) {
      return {
        ok: false,
        code: "MEMORY_SECRET_REJECTED",
        reason: "contains an absolute home path",
      };
    }
  }

  if (scope === "global" && !shortPreference(body)) {
    return {
      ok: false,
      code: "MEMORY_SECRET_REJECTED",
      reason: "global preferences must be short and must not contain project paths or code",
    };
  }

  return { ok: true };
}

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}
