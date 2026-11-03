import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { FileManagerError } from "@larness/resources";
import {
  TerminalIdSchema,
  type TerminalOutputChunk,
  TerminalOutputChunkSchema,
} from "@larness/shared";

const SEGMENT_BYTES = 1024 * 1024;
const NAME = /^(term_[a-f0-9-]{36})\.(\d+)\.jsonl$/;
export class TerminalOutput {
  readonly directory: string;
  readonly #ring: TerminalOutputChunk[] = [];
  #ringBytes = 0;
  #segment = 0;
  cursor = 0;
  constructor(
    dataDir: string,
    readonly id: string,
    readonly limits = { perTerminal: 10 * 1024 * 1024, total: 100 * 1024 * 1024 },
  ) {
    TerminalIdSchema.parse(id);
    const root = realpathSync(dataDir);
    const logs = path.join(root, "logs");
    if (!lstatSync(logs).isDirectory() || lstatSync(logs).isSymbolicLink())
      throw new Error("Output directory unavailable");
    this.directory = path.join(logs, "terminals");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(this.directory).isDirectory() || lstatSync(this.directory).isSymbolicLink())
      throw new Error("Output directory unavailable");
  }
  #segments() {
    return readdirSync(this.directory)
      .flatMap((name) => {
        const match = NAME.exec(name);
        if (!match) return [];
        const file = path.join(this.directory, name);
        const info = lstatSync(file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid output file");
        return [
          { file, id: match[1], index: Number(match[2]), size: info.size, mtime: info.mtimeMs },
        ];
      })
      .sort((a, b) => a.mtime - b.mtime || a.index - b.index);
  }
  append(data: string, now: number) {
    const row = TerminalOutputChunkSchema.parse({ cursor: this.cursor + 1, data, timestamp: now });
    const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
    if (bytes.length > this.limits.perTerminal || bytes.length > this.limits.total)
      throw new Error("Output quota unavailable");
    let segments = this.#segments();
    const current = () => path.join(this.directory, `${this.id}.${this.#segment}.jsonl`);
    const own = segments.find((segment) => segment.file === current());
    if (!own || own.size + bytes.length > Math.min(SEGMENT_BYTES, this.limits.perTerminal))
      this.#segment++;
    while (
      segments.filter((s) => s.id === this.id).reduce((n, s) => n + s.size, 0) + bytes.length >
        this.limits.perTerminal ||
      segments.reduce((n, s) => n + s.size, 0) + bytes.length > this.limits.total
    ) {
      const overOwn =
        segments.filter((s) => s.id === this.id).reduce((n, s) => n + s.size, 0) + bytes.length >
        this.limits.perTerminal;
      const victim = segments.find((s) => !overOwn || s.id === this.id);
      if (!victim) throw new Error("Output quota unavailable");
      unlinkSync(victim.file);
      segments = segments.filter((s) => s !== victim);
      if (victim.file === current()) this.#segment++;
    }
    const exists = segments.some((s) => s.file === current());
    const fd = openSync(
      current(),
      constants.O_WRONLY |
        constants.O_NOFOLLOW |
        (exists ? constants.O_APPEND : constants.O_CREAT | constants.O_EXCL),
      0o600,
    );
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const size = writeSync(fd, bytes, offset);
        if (!size) throw new Error("Output write failed");
        offset += size;
      }
    } finally {
      closeSync(fd);
    }
    this.cursor = row.cursor;
    this.#ring.push(row);
    this.#ringBytes += Buffer.byteLength(data);
    while (this.#ringBytes > 1024 * 1024 || this.#ring.length > 16384) {
      const old = this.#ring.shift();
      if (old) this.#ringBytes -= Buffer.byteLength(old.data);
    }
    return row;
  }
  read(after: number, limit: number, knownCursor: number) {
    const segments = this.#segments()
      .filter((s) => s.id === this.id)
      .sort((a, b) => a.index - b.index);
    const chunks: TerminalOutputChunk[] = [];
    let used = 0,
      current = knownCursor,
      oldest = 0,
      last = 0,
      gap = false,
      full = false;
    for (const segment of segments) {
      if (segment.size > SEGMENT_BYTES + 65536) throw new Error("Invalid output size");
      const fd = openSync(segment.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      let text: string;
      try {
        if (!fstatSync(fd).isFile()) throw new Error("Invalid output file");
        text = readFileSync(fd, "utf8");
      } finally {
        closeSync(fd);
      }
      for (const line of text.split("\n")) {
        if (!line) continue;
        let row: TerminalOutputChunk;
        try {
          row = TerminalOutputChunkSchema.parse(JSON.parse(line));
        } catch {
          gap = true;
          continue;
        }
        if (!oldest) oldest = row.cursor;
        current = Math.max(current, row.cursor);
        if (last && row.cursor !== last + 1) gap = true;
        last = row.cursor;
        if (
          row.cursor > after &&
          (chunks.length >= limit || used + Buffer.byteLength(row.data) > 65536)
        )
          full = true;
        if (
          !full &&
          row.cursor > after &&
          chunks.length < limit &&
          used + Buffer.byteLength(row.data) <= 65536
        ) {
          chunks.push(row);
          used += Buffer.byteLength(row.data);
        }
      }
    }
    if (after > current)
      throw new FileManagerError("VALIDATION_ERROR", "Output cursor is in the future");
    gap ||= after < current && (!oldest || after + 1 < oldest || last < current);
    return {
      chunks,
      oldestCursor: oldest || current + 1,
      nextCursor: chunks.at(-1)?.cursor ?? (gap ? current : after),
      truncated: oldest > 1 || gap,
      resyncRequired: gap,
    };
  }
  prune(now: number) {
    for (const segment of this.#segments())
      if (segment.mtime < now - 7 * 86400000) unlinkSync(segment.file);
  }
}
