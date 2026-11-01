import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  type ErrorResponse,
} from "@larness/shared";
import type { FastifyInstance } from "fastify";

interface HttpErrorOptions {
  status?: number;
  details?: unknown;
  cause?: unknown;
}

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: HttpErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "HttpError";
    this.code = code;
    this.status = options.status ?? ERROR_HTTP_STATUS[code];
    this.details = options.details;
  }
}

function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorResponse {
  return {
    error:
      details === undefined ? { code, message, requestId } : { code, message, details, requestId },
  };
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return null;
  }

  const statusCode = error.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      reply
        .code(error.status)
        .send(errorBody(error.code, error.message, request.id, error.details));
      return;
    }

    const clientStatus = clientErrorStatus(error);

    if (clientStatus !== null) {
      reply
        .code(clientStatus)
        .send(errorBody(ERROR_CODES.validation, "Invalid request", request.id));
      return;
    }

    request.log.error({ err: error }, "unhandled request error");
    reply.code(500).send(errorBody(ERROR_CODES.internal, "Internal server error", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(errorBody(ERROR_CODES.notFound, "Not found", request.id));
  });
}
