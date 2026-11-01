import { describe, expect, it } from "vitest";
import { createLogger } from "../src/bootstrap/logger.js";
import { createLogSink, withTempDir } from "./helpers.js";

describe("log redaction", () => {
  it("never writes cookies, tokens, passwords or pairing codes", async () => {
    await withTempDir(async (dir) => {
      const sink = createLogSink();
      const logger = createLogger({
        dataDir: dir,
        level: "info",
        retentionDays: 14,
        destination: sink.stream,
      });

      logger.info(
        {
          password: "hunter2-secret",
          token: "tok-123-secret",
          nested: { sessionToken: "sess-456-secret" },
          pairingCode: "ABCDE-FGHIJ",
          headers: { cookie: "larness_session=cookie-secret" },
          safe: "visible-value",
        },
        "login attempt",
      );

      await new Promise<void>((resolve) => logger.flush(() => resolve()));

      const text = sink.text();
      expect(text).toContain("login attempt");
      expect(text).toContain("visible-value");

      for (const secret of [
        "hunter2-secret",
        "tok-123-secret",
        "sess-456-secret",
        "ABCDE-FGHIJ",
        "cookie-secret",
      ]) {
        expect(text).not.toContain(secret);
      }

      expect(text).toContain("[Redacted]");
    });
  });

  it("redacts authorization and set-cookie headers", async () => {
    await withTempDir(async (dir) => {
      const sink = createLogSink();
      const logger = createLogger({
        dataDir: dir,
        level: "info",
        retentionDays: 1,
        destination: sink.stream,
      });

      logger.info(
        {
          req: { headers: { authorization: "Bearer top-secret", cookie: "larness_session=abc" } },
          res: { headers: { "set-cookie": "larness_session=def" } },
        },
        "request",
      );

      await new Promise<void>((resolve) => logger.flush(() => resolve()));

      const text = sink.text();
      expect(text).not.toContain("top-secret");
      expect(text).not.toContain("larness_session=abc");
      expect(text).not.toContain("larness_session=def");
    });
  });
});
