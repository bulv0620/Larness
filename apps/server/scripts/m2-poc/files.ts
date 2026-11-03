import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants, type FSWatcher, watch } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { assertInsideRoot } from "@larness/resources";
import { temporary, waitFor } from "./system.js";

const hash = (content: Buffer) => createHash("sha256").update(content).digest("hex");

async function readIdentity(root: string, target: string) {
  assertInsideRoot(root, await realpath(target));
  assert(!(await lstat(target)).isSymbolicLink());
  const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    assert(info.isFile());
    const current = await stat(target);
    assert.equal(info.ino, current.ino);
    assert.equal(info.dev, current.dev);
    const bytes = await fd.readFile();
    return { inode: info.ino, device: info.dev, version: hash(bytes), bytes };
  } finally {
    await fd.close();
  }
}

// Prototype only: the injected final race proves this is not an OS-level CAS.
async function replace(
  root: string,
  target: string,
  version: string,
  afterCheck?: () => Promise<void>,
) {
  const before = await readIdentity(root, target);
  assert.equal(before.version, version, "VERSION_CONFLICT");
  const temporaryFile = path.join(path.dirname(target), `.poc-${randomUUID()}`);
  try {
    const fd = await open(temporaryFile, "wx", 0o600);
    try {
      await fd.writeFile("saved\r\n");
      await fd.sync();
    } finally {
      await fd.close();
    }
    const current = await readIdentity(root, target);
    assert.equal(current.version, before.version, "VERSION_CONFLICT");
    assert.equal(current.inode, before.inode, "IDENTITY_CONFLICT");
    await afterCheck?.();
    await rename(temporaryFile, target);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

class WatchInvalidations {
  readonly pending = new Set<string>();
  resyncRequired = false;
  reason: string | null = null;
  constructor(readonly capacity: number) {}
  push(filename: string | null) {
    if (!filename || this.pending.size >= this.capacity) {
      this.invalidate("OVERFLOW_OR_UNKNOWN_NAME");
    } else if (!this.resyncRequired) this.pending.add(filename);
  }
  invalidate(reason: string) {
    this.pending.clear();
    this.resyncRequired = true;
    this.reason = reason;
  }
  async rescan(root: string) {
    const items = await readdir(root);
    assert(items.length <= 2_000, "SCAN_LIMIT_REACHED");
    this.pending.clear();
    this.resyncRequired = false;
    return items.sort();
  }
}

export async function probeFiles() {
  return temporary(async (directory) => {
    const root = await realpath(directory);
    const project = path.join(root, "project");
    await mkdir(project);
    const file = path.join(project, "file.txt");
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "outside must remain intact");
    await writeFile(file, "original\r\n");
    const original = await readIdentity(project, file);
    assert.equal(original.bytes.toString(), "original\r\n");
    const held = await open(file, "r");
    try {
      await writeFile(path.join(project, "replacement.txt"), "replacement");
      await rename(path.join(project, "replacement.txt"), file);
      assert.notEqual((await held.stat()).ino, (await stat(file)).ino);
      assert.equal((await held.readFile()).toString(), "original\r\n");
    } finally {
      await held.close();
    }
    await assert.rejects(replace(project, file, original.version), /VERSION_CONFLICT/);
    const fresh = await readIdentity(project, file);
    await replace(project, file, fresh.version);
    assert.equal((await readFile(file)).toString(), "saved\r\n");
    await symlink(outside, path.join(project, "link.txt"));
    await assert.rejects(readIdentity(project, path.join(project, "link.txt")));
    const sub = path.join(project, "sub");
    await mkdir(sub);
    await rename(sub, path.join(project, "old-sub"));
    await symlink(root, sub);
    await assert.rejects(readIdentity(project, path.join(sub, "outside.txt")));
    assert.equal(await readFile(outside, "utf8"), "outside must remain intact");

    const queue = new WatchInvalidations(2);
    let observed = 0;
    const watcher = watch(project, (_event, filename) => {
      observed++;
      queue.push(filename);
    });
    watcher.on("error", () => queue.invalidate("WATCH_ERROR"));
    try {
      await writeFile(file, "external modification");
      await waitFor(() => observed > 0, "native watcher change");
      const count = observed;
      await rename(file, path.join(project, "renamed.txt"));
      await waitFor(() => observed > count, "native watcher rename");
      const beforeDelete = observed;
      await rm(path.join(project, "renamed.txt"));
      await waitFor(() => observed > beforeDelete, "native watcher delete");
      // Deterministic queue overflow + OS error injection; not a claim that
      // the OS delivered a reliable event for every write.
      for (let i = 0; i < 32; i++) queue.push(`burst-${i}`);
      assert(queue.resyncRequired);
      watcher.emit("error", Object.assign(new Error("fixture"), { code: "ENOSPC" }));
      assert.equal(queue.reason, "WATCH_ERROR");
      await writeFile(file, "changed while notifications unavailable");
      const snapshot = await queue.rescan(project);
      assert(snapshot.includes("file.txt"));
      assert(!queue.resyncRequired);
    } finally {
      watcher.close();
    }

    // Demonstrate the unavoidable final-check -> rename window with a real
    // external write, so future APIs cannot advertise atomic filesystem CAS.
    const raceVersion = (await readIdentity(project, file)).version;
    await replace(project, file, raceVersion, () => writeFile(file, "external-after-check"));
    assert.equal(await readFile(file, "utf8"), "saved\r\n");
    assert(!(await readdir(project)).some((entry) => entry.startsWith(".poc-")));
    // Exercise the proposed instance watcher limit with real native handles.
    const watchers: FSWatcher[] = [];
    const watchRoot = path.join(root, "watch-limit");
    await mkdir(watchRoot);
    const attach = (directory: string) => {
      if (watchers.length >= 128) return false;
      const handle = watch(directory, () => {});
      handle.on("error", () => queue.invalidate("WATCH_ERROR"));
      watchers.push(handle);
      return true;
    };
    try {
      for (let index = 0; index < 128; index++) {
        const directory = path.join(watchRoot, String(index));
        await mkdir(directory);
        assert(attach(directory));
      }
      assert.equal(attach(watchRoot), false);
      const watched = path.join(watchRoot, "0");
      const watchedIdentity = await stat(watched);
      await rename(watched, path.join(watchRoot, "moved"));
      await mkdir(watched);
      assert.notEqual((await stat(watched)).ino, watchedIdentity.ino);
      queue.invalidate("WATCHED_DIRECTORY_REPLACED");
      assert((await queue.rescan(watchRoot)).includes("moved"));
    } finally {
      for (const handle of watchers) handle.close();
    }
    return {
      identity: true,
      version: true,
      atomicReplace: true,
      outsideLinkRejected: true,
      watcher: true,
      overflowRescan: true,
      externalRaceDemonstrated: true,
      watcherLimit: true,
    };
  });
}
