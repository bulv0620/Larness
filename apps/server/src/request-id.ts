import { randomUUID } from "node:crypto";

const CLIENT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;

  if (candidate && CLIENT_REQUEST_ID.test(candidate)) {
    return candidate;
  }

  return `req_${randomUUID()}`;
}
