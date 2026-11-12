import { defineTool, type ToolDefinition } from "@larness/agent";
import { z } from "zod";

/**
 * L0 read-only observation refresh. The system message carries a snapshot taken
 * at Turn start so the request prefix stays stable; this tool is how the model
 * asks for current state instead of relying on a per-step rewrite.
 */
export function createObservationTool(): ToolDefinition {
  return defineTool({
    name: "refresh_observations",
    description:
      "Read the current runtime observations for this workspace: temporary development previews, running terminals, the PM2 service snapshot and whether the project is now a Git repository, each with its observation time. Read-only and safe to call repeatedly. Use it before claiming that a service, deployment or terminal is in a particular state, or after another actor may have changed it. A RUNNING terminal or an online PM2 process still does not prove HTTP health.",
    riskLevel: "L0",
    requiresProjectLock: false,
    schema: z.object({}).strict(),
    summarize: () => "refresh runtime observations",
    handler: async (_args, context) =>
      context.refreshObservations
        ? context.refreshObservations()
        : { ok: false, errorCode: "FORBIDDEN", summary: "observation context unavailable" },
  });
}
