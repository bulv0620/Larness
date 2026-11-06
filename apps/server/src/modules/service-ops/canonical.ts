import { createHash } from "node:crypto";

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
  }
  throw new Error("canonical JSON does not support this value");
}

/** Deterministic JSON with recursively sorted object keys and preserved array order. */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
