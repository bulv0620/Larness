import { describe, expect, it } from "vitest";
import { MAX_LOG_LINES, parseArgs, UnknownCommandError, UsageError } from "../../src/cli/args.js";

describe("CLI argument parsing", () => {
  it("treats an empty command line as help", () => {
    expect(parseArgs([])).toMatchObject({ name: "help" });
  });

  it("parses help and version aliases", () => {
    expect(parseArgs(["--help"]).name).toBe("help");
    expect(parseArgs(["-h"]).name).toBe("help");
    expect(parseArgs(["help"]).name).toBe("help");
    expect(parseArgs(["--version"]).name).toBe("version");
    expect(parseArgs(["-v"]).name).toBe("version");
  });

  it.each(["start", "stop", "restart", "tui", "doctor"] as const)("parses %s", (name) => {
    expect(parseArgs([name])).toMatchObject({ name });
  });

  it("parses status --json", () => {
    expect(parseArgs(["status", "--json"])).toMatchObject({ name: "status", json: true });
    expect(parseArgs(["status"])).toMatchObject({ name: "status", json: false });
  });

  it("parses log options", () => {
    expect(parseArgs(["logs"])).toMatchObject({
      name: "logs",
      lines: 200,
      daemon: false,
      follow: false,
    });
    expect(parseArgs(["logs", "--lines", "50"])).toMatchObject({ lines: 50 });
    expect(parseArgs(["logs", "--lines=1000"])).toMatchObject({ lines: MAX_LOG_LINES });
    expect(parseArgs(["logs", "--daemon", "--follow"])).toMatchObject({
      daemon: true,
      follow: true,
    });
    expect(parseArgs(["logs", "-f"])).toMatchObject({ follow: true });
  });

  it.each(["0", "1001", "-1", "abc"])("rejects --lines %s", (value) => {
    expect(() => parseArgs(["logs", "--lines", value])).toThrow(UsageError);
  });

  it("rejects unknown options and unexpected arguments", () => {
    expect(() => parseArgs(["status", "--daemon"])).toThrow(UsageError);
    expect(() => parseArgs(["start", "extra"])).toThrow(UsageError);
    expect(() => parseArgs(["logs", "--lines"])).toThrow(UsageError);
  });

  it("reports unknown commands separately from usage errors", () => {
    expect(() => parseArgs(["deploy"])).toThrow(UnknownCommandError);
    expect(() => parseArgs(["--nope"])).toThrow(UnknownCommandError);
  });
});
