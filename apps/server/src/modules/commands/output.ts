import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { open, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  type CommandOutputChunk,
  FileManagerError,
  MAX_COMMAND_OUTPUT_BYTES,
  resolveFilePath,
} from "@larness/resources";
import { CommandOutputChunkSchema } from "@larness/shared";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const commandName = (id: string) => {
  if (!/^cmd_[a-f0-9-]{36}$/.test(id))
    throw new FileManagerError("VALIDATION_ERROR", "Invalid command ID");
  return `${id}.jsonl`;
};
export function outputPath(dataDir: string, id: string) {
  return path.join(dataDir, "logs", "commands", commandName(id));
}
export class CommandOutputFile {
  #fd: number | null;
  #size = 0;
  cursor = 0;
  truncated = false;
  constructor(dataDir: string, id: string) {
    mkdirSync(path.join(dataDir, "logs", "commands"), { recursive: true, mode: 0o700 });
    const root = realpathSync(dataDir);
    for (const directory of [path.join(root, "logs"), path.join(root, "logs", "commands")]) {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new FileManagerError("INTERNAL", "Output directory is unavailable");
    }
    this.#fd = openSync(
      outputPath(root, id),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  }
  append(chunk: CommandOutputChunk) {
    if (this.#fd === null) throw new Error("Output is closed");
    if (this.truncated) return;
    const row = { ...chunk, cursor: this.cursor + 1 };
    const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
    if (this.#size + bytes.length > MAX_FILE_BYTES) {
      this.truncated = true;
      return;
    }
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(this.#fd, bytes, offset);
      if (!written) throw new Error("Output write failed");
      offset += written;
    }
    this.cursor++;
    this.#size += bytes.length;
    return row;
  }
  close() {
    if (this.#fd === null) return;
    const fd = this.#fd;
    this.#fd = null;
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
export async function readCommandOutput(dataDir: string, id: string) {
  const root = await realpath(dataDir);
  const absolute = outputPath(root, id);
  let target: string;
  try {
    target = await resolveFilePath(root, path.relative(root, absolute));
  } catch (error) {
    if (error instanceof FileManagerError && error.code === "NOT_FOUND") return null;
    throw error;
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw new FileManagerError("INTERNAL", "Command output unavailable");
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const chunks = buffer
      .subarray(0, offset)
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => CommandOutputChunkSchema.parse(JSON.parse(line)));
    if (
      chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk.data), 0) >
      MAX_COMMAND_OUTPUT_BYTES
    )
      throw new FileManagerError("INTERNAL", "Command output unavailable");
    return chunks;
  } finally {
    await file.close();
  }
}
export async function removeCommandOutput(dataDir: string, id: string) {
  const root = await realpath(dataDir);
  const target = outputPath(root, id);
  try {
    await resolveFilePath(root, path.relative(root, target));
    await rm(target);
  } catch (error) {
    if (!(error instanceof FileManagerError && error.code === "NOT_FOUND")) throw error;
  }
}
