import { readFileSync } from "node:fs";

function readPackageMetadata(): { version?: unknown; engines?: { node?: unknown } } {
  try {
    return (
      JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) ?? {}
    );
  } catch {
    return {};
  }
}

const metadata = readPackageMetadata();
export const SERVER_VERSION = typeof metadata.version === "string" ? metadata.version : "0.0.0";
export const SUPPORTED_NODE_RANGE =
  typeof metadata.engines?.node === "string" ? metadata.engines.node : "22.x || >=24";
