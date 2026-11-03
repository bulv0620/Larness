// Isolated feasibility helpers, deliberately not wired to product execution.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function waitFor(test: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await test()) return;
    await delay(20);
  }
  throw new Error(`PoC timeout: ${label}`);
}

export async function temporary<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "larness-m2-poc-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function fixtureEnvironment(root: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, LANG: "C", TERM: "xterm-256color" };
}

// lstart + full fixture command is a feasibility identity, never a claim of
// race-free PID ownership. Unknown/mismatched identities must remain blocked.
export async function identity(pid: number): Promise<string | null> {
  try {
    const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "lstart=,command="], {
      maxBuffer: 8_192,
    });
    return stdout.trim() || null;
  } catch (error) {
    // ps exits 1 with empty stdout when the requested PID no longer exists.
    // Launch/permission/output-limit errors are unknown state, never "gone".
    if (z.object({ code: z.literal(1), stdout: z.literal("") }).safeParse(error).success)
      return null;
    throw error;
  }
}

export async function alive(pid: number) {
  try {
    const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "stat="], {
      maxBuffer: 1_024,
    });
    return stdout.trim().length > 0 && !stdout.trim().startsWith("Z");
  } catch (error) {
    if (z.object({ code: z.literal(1), stdout: z.literal("") }).safeParse(error).success)
      return false;
    throw error;
  }
}

export async function processTree(root: string) {
  const childCode = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const code = `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});
    process.on('SIGTERM',()=>{});
    console.log(JSON.stringify({pid:process.pid,child:child.pid}));
    setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["-e", code], {
    detached: true,
    cwd: root,
    env: fixtureEnvironment(root),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let failure: Error | undefined;
  child.on("error", (error) => {
    failure = error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    assert(output.length < 8_192);
  });
  try {
    await waitFor(() => {
      if (failure) throw failure;
      return output.includes("\n");
    }, "process tree ready");
    const pids = z
      .object({ pid: z.number().int().positive(), child: z.number().int().positive() })
      .parse(JSON.parse(output.trim()));
    assert.equal(pids.pid, child.pid);
    const original = await identity(pids.pid);
    assert(original);
    return {
      ...pids,
      original,
      async stop(expected = original) {
        if ((await identity(pids.pid)) !== expected) return false;
        process.kill(-pids.pid, "SIGTERM");
        await delay(80);
        // Fixtures deliberately ignore TERM: verify bounded escalation.
        process.kill(-pids.pid, "SIGKILL");
        await waitFor(
          async () => !(await alive(pids.pid)) && !(await alive(pids.child)),
          "tree exit",
        );
        return true;
      },
    };
  } catch (error) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }
    throw error;
  }
}
