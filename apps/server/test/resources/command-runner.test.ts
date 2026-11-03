import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OutputRedactor, runCommand } from "@larness/resources";
import { expect, it } from "vitest";

it("runs real commands with bounded output, cross-chunk redaction and filtered environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "larness-command-test-"));
  try {
    const chunks: string[] = [];
    const result = await runCommand({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write('fixed-');setTimeout(()=>{process.stdout.write('test-secret');console.error(process.env.LARNESS_SECRET||'clean');process.exitCode=7},30)",
      ],
      cwd: root,
      timeoutMs: 3000,
      secrets: ["fixed-test-secret"],
      env: { ...process.env, LARNESS_SECRET: "do-not-inherit" },
      onOutput: (chunk) => {
        chunks.push(chunk.data);
      },
    });
    expect(result).toMatchObject({
      exitCode: 7,
      reasonCode: "NONZERO_EXIT",
      stopped: true,
      truncated: false,
    });
    expect(chunks.join("")).toContain("[Redacted]");
    expect(chunks.join("")).not.toContain("fixed-test-secret");
    expect(chunks.join("")).not.toContain("do-not-inherit");
    expect(chunks.join("")).toContain("clean");
    const flood: string[] = [];
    const capped = await runCommand({
      executable: process.execPath,
      args: ["-e", "for(let i=0;i<100;i++)process.stdout.write('x'.repeat(32000))"],
      cwd: root,
      timeoutMs: 3000,
      onOutput: (chunk) => {
        flood.push(chunk.data);
      },
    });
    expect(capped.truncated).toBe(true);
    expect(Buffer.byteLength(flood.join(""))).toBeLessThanOrEqual(1024 * 1024);
    expect(capped.stopped).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reports spawn failure and timeouts without leaving a process group", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "larness-command-failure-"));
  try {
    expect(
      await runCommand({
        executable: path.join(root, "missing"),
        args: [],
        cwd: root,
        timeoutMs: 1000,
      }),
    ).toMatchObject({ reasonCode: "SPAWN_FAILED", stopped: true });
    expect(
      await runCommand({
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        cwd: root,
        timeoutMs: 100,
      }),
    ).toMatchObject({ reasonCode: "TIMED_OUT", stopped: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("masks sensitive JSON strings and whole authentication headers across every split", async () => {
  const { OutputRedactor } = await import("@larness/resources");
  const input =
    "public-prefix".repeat(30) +
    '{"apiKey":"private with space","password":"escaped\\"inside"}\nCookie: session=one; other=two\nAuthorization: Bearer secret-token\npublic\n';
  for (let split = 0; split <= input.length; split++) {
    const redact = new OutputRedactor([]);
    const output = redact.push(input.slice(0, split)) + redact.push(input.slice(split), true);
    expect(output).toContain("public");
    for (const value of [
      "private with space",
      "escaped",
      "inside",
      "session=one",
      "other=two",
      "secret-token",
    ])
      expect(output).not.toContain(value);
  }
});

it("streams ordinary terminal prompts immediately while retaining partial secret prefixes", () => {
  const publicOutput = new OutputRedactor(["sk-terminal-secret"]);
  expect(publicOutput.push("ready> ")).toBe("ready> ");
  expect(publicOutput.push("sk-terminal-")).toBe("");
  expect(publicOutput.push("secret\n")).toBe("[Redacted]\n");
  const fields = new OutputRedactor([]);
  expect(fields.push("pass")).toBe("");
  expect(fields.push("word=hidden\nready> ")).toBe("password=[Redacted]\nready> ");
});

it("shows a sensitive field prompt before its value arrives without leaking a split quoted value", () => {
  const redact = new OutputRedactor([]);
  expect(redact.push("Password: ")).toBe("Password: ");
  expect(redact.push('"hidden with space"\n')).toBe('"[Redacted]"\n');
});
