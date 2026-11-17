/**
 * Plan-progress reminder (B of the plan-progress slice).
 *
 * Long Turns used to touch the plan exactly twice: `pending` at the start and
 * everything `done` at the end. Between those two events the user watched a
 * plan that described no progress at all, because nothing in the runtime ever
 * asked the model to advance it. The prompt alone is a soft constraint, and a
 * full step-by-step rewrite costs an extra round trip, so the model batches it
 * to the end where the wrap-up hint already reminds it.
 *
 * This module is the deterministic half: after enough tool calls without a
 * plan update, the runner appends one reminder to the next request. It is a
 * hint, never a rewrite — the server still refuses to complete a step the
 * model did not report, and a cancelled or failed Turn never gets its steps
 * ticked automatically.
 */

/** Tool calls allowed between plan updates before the model is asked to catch up. */
export const PLAN_STALE_TOOL_CALLS = 6;

/** Bounded so the reminder cannot become the new context problem. */
export const MAX_QUOTED_OPEN_STEPS = 5;

export interface PlanReminderStep {
  id: string;
  title: string;
  status: string;
}

export interface PlanReminderInput {
  steps: readonly PlanReminderStep[];
  /** Tool calls executed since the last `update_plan`, counted per call. */
  toolCallsSincePlanUpdate: number;
  /** One reminder per plan version keeps a stubborn model from being nagged. */
  alreadyReminded: boolean;
  /** Overrides `PLAN_STALE_TOOL_CALLS`; `<= 0` disables the reminder. */
  threshold?: number;
}

/** `done` and `failed` are settled for this Turn, so they are not worth quoting. */
function isOpen(step: PlanReminderStep): boolean {
  return step.status !== "done" && step.status !== "failed";
}

/**
 * Returns the reminder text to append to the next provider request, or `null`
 * when the plan is fresh, settled, absent or already reminded.
 */
export function stalePlanReminder(input: PlanReminderInput): string | null {
  if (input.alreadyReminded) {
    return null;
  }

  const threshold = input.threshold ?? PLAN_STALE_TOOL_CALLS;

  if (threshold <= 0 || input.toolCallsSincePlanUpdate < threshold) {
    return null;
  }

  const open = input.steps.filter(isOpen);
  const current = open.find((step) => step.status === "running") ?? open[0];

  if (current === undefined) {
    return null;
  }

  const quoted = open
    .slice(0, MAX_QUOTED_OPEN_STEPS)
    .map((step) => `${step.id}: ${step.title} (${step.status})`);
  const omitted = open.length - quoted.length;
  const list = omitted > 0 ? `${quoted.join("; ")}; +${omitted} more` : quoted.join("; ");

  return [
    `The plan has not changed for ${input.toolCallsSincePlanUpdate} tool calls while step ${current.id}: ${current.title} is still ${current.status}.`,
    "Update the plan with update_plan in the same batch as your next tool call: mark a step done only when it is finished and verified, set the step you are working on to running, and re-scope or add steps that appeared while working.",
    "Do not leave every status change for the end of the turn.",
    `Unfinished steps: ${list}.`,
  ].join(" ");
}
