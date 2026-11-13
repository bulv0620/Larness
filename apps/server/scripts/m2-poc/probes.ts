import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn as spawnPty } from "node-pty";
import { z } from "zod";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { acquireResourceLock, renewResourceLock } from "../../src/modules/locks/service.js";
import { alive, delay, fixtureEnvironment, processTree, temporary, waitFor } from "./system.js";

export { probeFiles } from "./files.js";
export { probeRoots } from "./roots.js";

export async function probePty() {
  return temporary(async (root) => {
    const terminal = spawnPty("/bin/sh", [], {
      cols: 80,
      rows: 24,
      cwd: root,
      env: fixtureEnvironment(root),
      name: "xterm-256color",
    });
    let output = "";
    let exited = false;
    terminal.onData((data) => {
      output = (output + data).slice(-65_536);
    });
    terminal.onExit(() => {
      exited = true;
    });
    try {
      // Markers split in the command avoid matching terminal input echo.
      terminal.write("printf 'M2_%s\\n' INPUT_OK\r");
      await waitFor(() => output.includes("M2_INPUT_OK"), "PTY input/output");
      terminal.resize(103, 37);
      terminal.write("stty size\r");
      await waitFor(() => /37\s+103/.test(output), "PTY resize");
      terminal.write("sleep 30 && printf 'M2_%s\\n' SHOULD_NOT_FINISH\r");
      await delay(100);
      terminal.write("\x03");
      await delay(80);
      terminal.write("printf 'M2_%s\\n' INTERRUPTED_OK\r");
      await waitFor(() => output.includes("M2_INTERRUPTED_OK"), "PTY interrupt");
      assert(!output.includes("M2_SHOULD_NOT_FINISH"));
      terminal.kill();
      await waitFor(async () => exited && !(await alive(terminal.pid)), "PTY terminate");
      const dev = spawnPty(
        process.execPath,
        [
          "-e",
          `
        const {spawn}=require('node:child_process');
        const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
        process.on('SIGTERM',()=>{});
        console.log(JSON.stringify({child:child.pid}));setInterval(()=>{},1000);
      `,
        ],
        { cols: 80, rows: 24, cwd: root, env: fixtureEnvironment(root) },
      );
      let devOutput = "";
      let devExited = false;
      let descendant: number | undefined;
      dev.onData((data) => {
        devOutput = (devOutput + data).slice(-8_192);
      });
      dev.onExit(() => {
        devExited = true;
      });
      try {
        await waitFor(() => devOutput.includes("\n"), "dev PTY child ready");
        descendant = z
          .object({ child: z.number().int().positive() })
          .parse(JSON.parse(devOutput.trim())).child;
        assert(await alive(descendant));
        process.kill(-dev.pid, "SIGTERM");
        await delay(80);
        process.kill(-dev.pid, "SIGKILL");
        await waitFor(
          async () =>
            devExited &&
            !(await alive(dev.pid)) &&
            descendant !== undefined &&
            !(await alive(descendant)),
          "dev PTY process group cleanup",
        );
      } finally {
        if (!devExited) {
          process.kill(-dev.pid, "SIGKILL");
          await waitFor(() => devExited, "dev cleanup");
        }
        if (descendant && (await alive(descendant))) process.kill(descendant, "SIGKILL");
      }
      return {
        input: true,
        resize: true,
        interrupt: true,
        stopped: true,
        processTreeStopped: true,
      };
    } finally {
      if (!exited) {
        terminal.kill("SIGKILL");
        await waitFor(() => exited, "PTY final cleanup");
      }
    }
  });
}

export async function probeProcesses(migrations?: string) {
  return temporary(async (root) => {
    for (const trigger of ["cancel", "timeout", "leaseLoss"] as const) {
      const tree = await processTree(root);
      try {
        assert.equal(await tree.stop("reused-pid-different-start"), false);
        assert(await alive(tree.pid));
        const controller = new AbortController();
        const stopped = new Promise<boolean>((resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => {
              void tree.stop().then(resolve, reject);
            },
            { once: true },
          );
        });
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          if (trigger === "timeout") deadline = setTimeout(() => controller.abort("timeout"), 50);
          else if (trigger === "leaseLoss") {
            const opened = openDatabase(path.join(root, "lease.db"));
            try {
              runMigrations(opened.db, migrations);
              const handle = acquireResourceLock(
                { db: opened.db, now: () => 1_000 },
                {
                  resourceType: "project",
                  resourceId: root,
                  owner: "poc",
                  executionId: "lease-loss",
                  ttlMs: 100,
                },
              );
              assert(handle);
              // Expired-but-owned leases can be revived; simulate a real
              // lease loss by letting another writer take the row over.
              const replacement = acquireResourceLock(
                { db: opened.db, now: () => 1_200 },
                {
                  resourceType: "project",
                  resourceId: root,
                  owner: "replacement",
                  executionId: "replacement",
                  ttlMs: 100,
                },
              );
              assert(replacement);
              assert(replacement.fencingToken > handle.fencingToken);
              const renewed = renewResourceLock(
                { db: opened.db, now: () => 1_200 },
                {
                  id: handle.id,
                  fencingToken: handle.fencingToken,
                  ttlMs: 100,
                },
              );
              assert.equal(renewed, null);
              if (!renewed) controller.abort("lease-lost");
            } finally {
              opened.close();
            }
          } else controller.abort("cancel");
          assert.equal(await stopped, true);
        } finally {
          clearTimeout(deadline);
        }
        assert(!(await alive(tree.pid)));
        assert(!(await alive(tree.child)));
      } finally {
        await tree.stop();
      }
    }

    // Actual separate supervisor process: exit signal runs cleanup before
    // supervisor completion. No IPC port / user data / TUI input is touched.
    const record = path.join(root, "supervisor.json");
    const code = `const fs=require('node:fs'),{spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      fs.writeFileSync(process.argv[1],JSON.stringify({pid:child.pid}));
      process.on('SIGTERM',()=>{process.kill(-child.pid,'SIGKILL');process.exit(0)});
      setInterval(()=>{},1000);`;
    const supervisor = spawn(process.execPath, ["-e", code, record], {
      cwd: root,
      env: fixtureEnvironment(root),
      stdio: "ignore",
    });
    let exited = false;
    supervisor.on("exit", () => {
      exited = true;
    });
    let managedPid: number | undefined;
    try {
      await waitFor(async () => {
        try {
          return (await readFile(record, "utf8")).length > 0;
        } catch {
          return false;
        }
      }, "supervisor ready");
      const parsed = z
        .object({ pid: z.number().int().positive() })
        .parse(JSON.parse(await readFile(record, "utf8")));
      managedPid = parsed.pid;
      assert(await alive(managedPid));
      supervisor.kill("SIGTERM");
      await waitFor(async () => exited && !(await alive(parsed.pid)), "supervisor cleanup");
      await writeFile(record, "cleanup confirmed");
    } finally {
      if (!exited) supervisor.kill("SIGKILL");
      if (managedPid && (await alive(managedPid))) process.kill(-managedPid, "SIGKILL");
    }
    return {
      cancel: true,
      timeout: true,
      leaseLoss: true,
      supervisorExit: true,
      unknownIdentityBlocked: true,
    };
  });
}
