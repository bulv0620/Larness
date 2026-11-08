import { readFileSync } from "node:fs";

function readPackageVersion(): string {
  try {
    const raw = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as {
      version?: unknown;
    };
    return typeof raw.version === "string" ? raw.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const SERVER_VERSION = readPackageVersion();
