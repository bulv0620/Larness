import { ERROR_HTTP_STATUS } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import { ApprovalError, decideApproval, getApproval } from "../modules/agent/approvalService.js";

const ApprovalIdSchema = z.string().min(1).max(128);

const DecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export interface ApprovalApiDeps {
  db: Database;
  now?: () => number;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new HttpError("VALIDATION_ERROR", "Invalid request", {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

function throwApproval(error: unknown): never {
  if (error instanceof ApprovalError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

export function registerApprovalRoutes(app: FastifyInstance, deps: ApprovalApiDeps): void {
  app.get<{ Params: { id: string } }>("/api/approvals/:id", async (request) => {
    const id = parse(ApprovalIdSchema, request.params.id);

    try {
      return getApproval({ db: deps.db, now: deps.now }, id);
    } catch (error) {
      throwApproval(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/approvals/:id", async (request) => {
    const id = parse(ApprovalIdSchema, request.params.id);
    const body = parse(DecisionSchema, request.body);
    const decidedBy = request.clientSession?.id;

    if (decidedBy === undefined) {
      throw new HttpError("UNAUTHENTICATED", "authentication required");
    }

    try {
      return decideApproval(
        { db: deps.db, now: deps.now },
        {
          id,
          decision: body.decision,
          decidedBy,
          clientSessionId: decidedBy,
        },
      );
    } catch (error) {
      throwApproval(error);
    }
  });
}
