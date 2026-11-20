import type { EncryptedSecretRef } from "@larness/agent";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

export const REDACTED_TOOL_SUMMARY = "tool arguments redacted";

/**
 * `tool.requested` is persisted before the handler runs, so the summary must
 * not carry a configured credential even when the tool would later reject it.
 */
export function safeToolSummary(
  summary: string,
  secrets: EncryptedSecretRef[],
  secretStore: SecretStore | undefined,
): string {
  return secretVerdict([summary], secrets, secretStore) === "ok" ? summary : REDACTED_TOOL_SUMMARY;
}
