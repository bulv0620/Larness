import { defineTool, type ToolDefinition } from "@larness/agent";
import { PlanParamsSchema } from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

export function createPlanTool(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition {
  return defineTool({
    name: "update_plan",
    description:
      "Create or replace this turn's task plan for complex work. Use stable step IDs, at most one running step, and update progress as work completes. Do not invent completion or use for simple questions. This only records metadata; it does not authorize actions.",
    riskLevel: "L0",
    requiresProjectLock: false,
    schema: PlanParamsSchema,
    summarize: () => "更新任务计划",
    handler: async (args, context) => {
      if (!context.updatePlan) {
        return { ok: false, errorCode: "FORBIDDEN", summary: "Plan context unavailable" };
      }

      const verdict = secretVerdict(
        [JSON.stringify(args)],
        context.loadSecrets?.() ?? [],
        options.secretStore,
      );

      if (verdict === "unavailable") {
        return { ok: false, errorCode: "FORBIDDEN", summary: "Plan protection unavailable" };
      }

      if (verdict === "blocked") {
        return { ok: false, errorCode: "FORBIDDEN", summary: "Protected plan content" };
      }

      return context.updatePlan(args);
    },
  });
}
