import { describe, expect, it } from "vitest";
import {
  errorResponse,
  InitApplyParamsSchema,
  IpcError,
  type IpcResponse,
} from "../../src/ipc/protocol.js";

describe("IPC protocol", () => {
  it("validates init.apply params", () => {
    expect(
      InitApplyParamsSchema.safeParse({
        adminPassword: "short",
        host: "127.0.0.1",
        port: 3210,
      }).success,
    ).toBe(false);

    expect(
      InitApplyParamsSchema.safeParse({
        host: "127.0.0.1",
        port: 3210,
        publicUrl: "https://larness.example.com",
        channel: "stable",
      }).success,
    ).toBe(true);

    expect(
      InitApplyParamsSchema.safeParse({
        host: "127.0.0.1",
        port: 3210,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts default initialization without a password and rejects legacy password parameters", () => {
    expect(InitApplyParamsSchema.safeParse({}).success).toBe(true);
    expect(
      InitApplyParamsSchema.safeParse({ adminPassword: "correct horse battery" }).success,
    ).toBe(false);
    expect(InitApplyParamsSchema.safeParse({ port: 70000 }).success).toBe(false);
    expect(InitApplyParamsSchema.safeParse({ publicUrl: "https://example.com/path" }).success).toBe(
      false,
    );
  });

  it("maps IpcError and unexpected errors into stable responses", () => {
    expect(errorResponse("1", new IpcError("FORBIDDEN", "no"))).toEqual({
      id: "1",
      ok: false,
      error: { code: "FORBIDDEN", message: "no" },
    });

    const internal = errorResponse("2", new Error("secret detail")) as IpcResponse;
    expect(internal).toEqual({
      id: "2",
      ok: false,
      error: { code: "INTERNAL", message: "Internal IPC error" },
    });
  });
});
