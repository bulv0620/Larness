import { defineTool, type ToolDefinition } from "@larness/agent";
import { PlanParamsSchema } from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { listEncryptedSecrets } from "../models/repository.js";

export function createPlanTool(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition {
  const schema = PlanParamsSchema.superRefine((args, context) => {
    const secrets = listEncryptedSecrets(options.db);
    const text = JSON.stringify(args);
    if (
      secrets.some((secret) => {
        const value = options.secretStore?.decrypt(secret);
        return !value || text.includes(value);
      })
    )
      context.addIssue({ code: "custom", message: "Protected plan content" });
  });
  return defineTool({
    name: "update_plan",
    description:
      "Create or replace this turn's task plan for complex work. Use stable step IDs, at most one running step, and update progress as work completes. Do not invent completion or use for simple questions. This only records metadata; it does not authorize actions.",
    riskLevel: "L0",
    requiresProjectLock: false,
    schema,
    summarize: () => "更新任务计划",
    handler: async (args, context) =>
      context.updatePlan
        ? context.updatePlan(args)
        : { ok: false, errorCode: "FORBIDDEN", summary: "Plan context unavailable" },
  });
}
