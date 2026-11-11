export function canonicalArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalArgs);
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalArgs(record[key])]),
    );
  }

  return value;
}

/** Identical calls must compare equal regardless of argument key order. */
export function stableArgsKey(name: string, args: unknown): string {
  return `${name}|${JSON.stringify(canonicalArgs(args))}`;
}

export function turnInputText(json: string): string {
  try {
    const parsed = JSON.parse(json) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}
