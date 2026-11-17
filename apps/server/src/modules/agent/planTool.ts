import { defineTool, type ToolDefinition } from "@larness/agent";
import { PlanParamsSchema } from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

/**
 * Models reliably write `in_progress` / `completed` even though the schema says
 * `running` / `done`. Normalize the common vocabulary before validation so a
 * wording slip does not burn a whole model step; unknown words still fail.
 */
const STATUS_ALIASES: Record<string, string> = {
  pending: "pending",
  todo: "pending",
  queued: "pending",
  not_started: "pending",
  "not-started": "pending",
  running: "running",
  in_progress: "running",
  "in-progress": "running",
  inprogress: "running",
  active: "running",
  done: "done",
  completed: "done",
  complete: "done",
  finished: "done",
  failed: "failed",
  error: "failed",
};

function repairPlanArgs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;

  const plan = raw as Record<string, unknown>;

  if (!Array.isArray(plan.steps)) return raw;

  let changed = false;
  const steps = plan.steps.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

    const step = value as Record<string, unknown>;

    if (typeof step.status !== "string") return value;

    const mapped = STATUS_ALIASES[step.status.trim().toLowerCase().replace(/\s+/g, "_")];

    if (mapped === undefined || mapped === step.status) return value;

    changed = true;
    return { ...step, status: mapped };
  });

  return changed ? { ...plan, steps } : raw;
}

export function createPlanTool(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition {
  return defineTool({
    name: "update_plan",
    description:
      "Create or replace this turn's task plan for complex work, and advance it while you work instead of once at the end. Keep stable step IDs and at most one running step. When a step finishes, call this again in the same batch as your next tool call: mark that step done, set the step you are working on to running, and re-scope or add steps that appeared — do not defer every status change to the end of the turn. The status is your report of progress, so never mark a step done before it is finished and verified, and never tick a cancelled or failed step as done. Simple questions need no plan. This only records metadata; it does not authorize actions.",
    riskLevel: "L0",
    requiresProjectLock: false,
    schema: PlanParamsSchema,
    repairArgs: repairPlanArgs,
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
