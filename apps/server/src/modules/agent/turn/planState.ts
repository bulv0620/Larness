import { PlanParamsSchema } from "@larness/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { agentEvents } from "../../../db/schema.js";

export type PlanStepStatus = "pending" | "running" | "done" | "failed";

export interface PlanSnapshot {
  title: string;
  steps: Array<{ id: string; title: string; status: PlanStepStatus }>;
  turnId: string | null;
}

function parsePlanPayload(json: string): PlanSnapshot | null {
  try {
    const payload = JSON.parse(json) as {
      turnId?: unknown;
      plan?: { title?: unknown; steps?: unknown };
    };
    const plan = PlanParamsSchema.safeParse({
      title: payload.plan?.title,
      steps: payload.plan?.steps,
    });

    if (!plan.success) {
      return null;
    }

    return {
      title: plan.data.title,
      steps: plan.data.steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
      })),
      turnId: typeof payload.turnId === "string" ? payload.turnId : null,
    };
  } catch {
    return null;
  }
}

/** Latest plan event for a session, optionally scoped to one Turn. */
export function latestPlan(db: Database, sessionId: string, turnId?: string): PlanSnapshot | null {
  const rows = db
    .select({ payloadJson: agentEvents.payloadJson })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.sessionId, sessionId),
        eq(agentEvents.type, "plan.updated"),
        ...(turnId === undefined ? [] : [eq(agentEvents.turnId, turnId)]),
      ),
    )
    .orderBy(desc(agentEvents.seq))
    .limit(20)
    .all();

  for (const row of rows) {
    const plan = parsePlanPayload(row.payloadJson);

    if (plan !== null) {
      return plan;
    }
  }

  return null;
}

/**
 * The current plan belongs in the per-Turn tail while it still has work open.
 * A fully completed plan is noise for the next request.
 */
export function currentPlanText(db: Database, sessionId: string): string | null {
  const plan = latestPlan(db, sessionId);

  if (plan === null) {
    return null;
  }

  const open = plan.steps.filter((step) => step.status !== "done");

  if (open.length === 0) {
    return null;
  }

  const lines = plan.steps.map((step) => `- [${step.status}] ${step.title}`);
  return [
    "Current plan (system-recorded; may be stale; update it if the task changed):",
    `${plan.title}`,
    ...lines,
  ].join("\n");
}

/** Pending/running steps from the plan updated in the current Turn. */
export function openPlanSteps(
  db: Database,
  sessionId: string,
  turnId: string,
): Array<{ id: string; title: string; status: "pending" | "running" }> {
  const plan = latestPlan(db, sessionId, turnId);

  if (plan === null) {
    return [];
  }

  return plan.steps.flatMap((step) =>
    step.status === "pending" || step.status === "running"
      ? [{ id: step.id, title: step.title, status: step.status }]
      : [],
  );
}
