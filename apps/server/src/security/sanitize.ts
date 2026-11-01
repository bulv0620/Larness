const SENSITIVE_KEY = /(password|token|secret|cookie|authorization|pairing|csrf|api[-_]?key|hash)/i;

export function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditDetails(item));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? "[Redacted]" : sanitizeAuditDetails(entry);
    }

    return result;
  }

  return value;
}
