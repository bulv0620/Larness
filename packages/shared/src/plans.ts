import { z } from "zod";

export const PlanStepSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(200),
    detail: z.string().max(500).optional(),
    status: z.enum(["pending", "running", "done", "failed"]),
  })
  .strict();
export const PlanParamsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    steps: z.array(PlanStepSchema).min(1).max(12),
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length)
      context.addIssue({ code: "custom", message: "Step IDs must be unique" });
    if (plan.steps.filter((step) => step.status === "running").length > 1)
      context.addIssue({ code: "custom", message: "Only one step can be running" });
  });
export const PlanItemSchema = PlanParamsSchema.safeExtend({
  id: z.string().min(1),
  kind: z.literal("plan"),
  createdAt: z.number().int().nonnegative(),
  turnId: z.string().optional(),
});
export type PlanParams = z.infer<typeof PlanParamsSchema>;
