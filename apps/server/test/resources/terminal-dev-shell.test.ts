import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { processAlive } from "@larness/resources";
import { expect, it } from "vitest";
import { createProject } from "../../src/modules/projects/service.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Terminal Shell fixture timed out");
}
async function contents(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}
function shellWrite(shell: string, file: string, value: string): string {
  if (process.platform !== "win32") return `printf '${value}' > ${file}\r`;
  return path.basename(shell).toLowerCase() === "cmd.exe"
    ? `>${file} echo ${value}\r`
    : `Set-Content -LiteralPath '${file}' -Value '${value}' -Encoding ASCII\r`;
}
async function written(file: string, value: string): Promise<boolean> {
  return (await contents(file)).trim() === value;
}
async function fixture(dir: string) {
  const f = await startAuthorizedServer(path.join(dir, "data"));
  const root = path.join(dir, "project");
  await mkdir(root);
  const project = await createProject({ db: f.running.db }, { rootPath: root });
  const session = await createSession(
    { db: f.running.db, dataDir: f.running.dataDir },
    { projectId: project.id },
  );
  const client = (
    await f.running.app.inject({ url: "/api/auth/session", headers: { cookie: f.cookie } })
  ).json().clientSessionId as string;
  const turn = createTurn(
    { db: f.running.db },
    { sessionId: session.id, text: "dev shell", clientSessionId: client },
  );
  updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
  const context = {
    clientSessionId: client,
    projectId: project.id,
    sessionId: session.id,
    turnId: turn.turnId,
    toolCallId: "start",
    policySnapshotId: "approved",
    assertAuthorized: () => {},
  };
  const manager = f.running.terminals;
  return {
    f,
    root,
    manager,
    context,
    client,
    start: (executable: string, args: string[]) =>
      manager.createDev(context, { role: "frontend", executable, args }),
    input: async (id: string) => {
      const connection = randomUUID();
      manager.connect(client, connection, () => true);
      manager.subscribe(id, connection);
      const lease = await manager.lease(id, client, {
        action: "acquire",
        connectionId: connection,
      });
      const generation = lease.lease?.generation;
      if (!generation) throw new Error("Missing input lease");
      let sequence = 0;
      return (data: string) => manager.input(id, client, connection, generation, ++sequence, data);
    },
  };
}
it("Ctrl+C stops the agent's foreground service but preserves the PTY for later human input", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const row = await f.start(process.execPath, [
        "-e",
        `const net=require('node:net'),fs=require('node:fs');const s=net.createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync('service.json',JSON.stringify({port:s.address().port,pid:process.pid})));`,
      ]);
      const serviceFile = path.join(f.root, "service.json");
      await until(async () => !!(await contents(serviceFile)));
      const { port, pid } = JSON.parse(await readFile(serviceFile, "utf8")) as {
        port: number;
        pid: number;
      };
      const input = await f.input(row.id);
      await input("\x03");
      await until(async () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      const connected = await new Promise<boolean>((resolve) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => resolve(false));
      });
      expect(connected).toBe(false);
      expect(await f.manager.read(row.id)).toMatchObject({
        id: row.id,
        status: "RUNNING",
        exitCode: null,
      });
      await input(shellWrite(row.shell, "resumed.txt", "resumed"));
      await until(async () => written(path.join(f.root, "resumed.txt"), "resumed"));
      const events = f.f.running.sqlite
        .prepare("SELECT type FROM resource_events WHERE stream_id = ?")
        .all(row.id);
      expect(events).not.toContainEqual({ type: "terminal.exit" });
      expect((await f.manager.terminate(row.id, f.client)).status).toBe("TERMINATED");
    } finally {
      await stopAuthorizedServer(f.f);
    }
  });
});
it.each([0, 9])(
  "keeps a usable Shell after the approved command returns %s, passing argv literally",
  async (code) => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const args = [
          "space value",
          "'\"; touch injected; #",
          "$(touch injected)",
          "line\nvalue",
          "\x03",
          "",
          "--flag",
        ];
        const row = await f.start(process.execPath, [
          "-e",
          `require('node:fs').writeFileSync('args.json',JSON.stringify(process.argv.slice(1)));console.log('COMMAND_EXIT_${code}');process.exitCode=${code}`,
          ...args,
        ]);
        await until(async () => !!(await contents(path.join(f.root, "args.json"))));
        expect(JSON.parse(await readFile(path.join(f.root, "args.json"), "utf8"))).toEqual(args);
        const input = await f.input(row.id);
        await input(shellWrite(row.shell, "usable.txt", "usable"));
        await until(async () => written(path.join(f.root, "usable.txt"), "usable"));
        await expect(readFile(path.join(f.root, "injected"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect((await f.manager.read(row.id)).status).toBe("RUNNING");
        // Explicit exit still ends the whole terminal, unlike a foreground command exit.
        await input(`exit ${code}\r`);
        await until(async () => (await f.manager.read(row.id)).status === "EXITED");
        expect((await f.manager.read(row.id)).exitCode).toBe(code);
      } finally {
        await stopAuthorizedServer(f.f);
      }
    });
  },
);
it.each(["missing-program", "eval"])(
  "keeps the terminal usable when %s is not an external executable",
  async (program) => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const row = await f.start(program === "eval" ? "eval" : path.join(f.root, program), [
          "touch unexpected",
        ]);
        expect((await f.manager.read(row.id)).status).toBe("RUNNING");
        const input = await f.input(row.id);
        await input(shellWrite(row.shell, "recovery.txt", "recover"));
        await expect(readFile(path.join(f.root, "unexpected"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await until(async () => written(path.join(f.root, "recovery.txt"), "recover"));
      } finally {
        await stopAuthorizedServer(f.f);
      }
    });
  },
);

it("explicit stop still cleans the bootstrap Shell and its foreground process tree", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const child =
        "require('node:fs').writeFileSync('child-pid',String(process.pid));setInterval(()=>{},1000)";
      const row = await f.start(process.execPath, [
        "-e",
        `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});fs.writeFileSync('parent-pid',String(process.pid));setInterval(()=>{},1000)`,
      ]);
      await until(async () => !!(await contents(path.join(f.root, "child-pid"))));
      const parent = Number(await readFile(path.join(f.root, "parent-pid"), "utf8"));
      const childPid = Number(await readFile(path.join(f.root, "child-pid"), "utf8"));
      expect((await f.manager.terminate(row.id, f.client)).status).toBe("TERMINATED");
      expect(processAlive(parent)).toBe(false);
      expect(processAlive(childPid)).toBe(false);
    } finally {
      await stopAuthorizedServer(f.f);
    }
  });
});
