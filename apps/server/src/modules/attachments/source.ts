import { MAX_SOURCE_SLICE_CHARS } from "./types.js";

/**
 * `source` is the second projection of an attachment: the original UTF-8
 * bytes, paged by line. It exists because Markdown conversion is lossy for
 * code, CSS, configuration and HTML structure, and coding tasks need the exact
 * text.
 */

export interface SourceSlice {
  content: string;
  /** 1-based first line of `content`. */
  lineStart: number;
  /** 1-based last line of `content`. */
  lineEnd: number;
  totalLines: number;
  /** 1-based line to request next, or null when the slice reaches the end. */
  nextLine: number | null;
  /** Character offset to request next; always set while content remains. */
  nextOffset: number | null;
  truncated: boolean;
}

export interface SourceSliceInput {
  line?: number;
  offset?: number;
  maxChars: number;
}

export function decodeSource(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

export function sourceLineCount(text: string): number {
  return text.length === 0 ? 0 : countNewlines(text) + 1;
}

function lineStartOffset(text: string, line: number): number {
  if (line <= 1) return 0;
  let seen = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    seen += 1;
    if (seen === line) return index + 1;
  }
  return text.length;
}

/**
 * Character-bounded slice aligned to line boundaries, so an anchor always
 * points at the start of a line. A single oversized line (minified bundle) is
 * cut inside the line instead of returning megabytes.
 */
export function sourceSlice(text: string, input: SourceSliceInput): SourceSlice {
  const maxChars = Math.max(1, Math.min(input.maxChars, MAX_SOURCE_SLICE_CHARS));
  const totalLines = sourceLineCount(text);
  let start = Math.max(0, input.offset ?? 0);
  if (input.line !== undefined) start = lineStartOffset(text, Math.max(1, input.line));
  if (start > text.length) start = text.length;

  let end = Math.min(text.length, start + maxChars);
  let midLine = false;
  if (end < text.length) {
    const newline = text.lastIndexOf("\n", end);
    if (newline > start) end = newline + 1;
    else midLine = true;
  }

  const content = text.slice(start, end);
  const lineStart = Math.min(totalLines, countNewlines(text.slice(0, start)) + 1);
  const lineEnd =
    lineStart + Math.max(0, countNewlines(content) - (content.endsWith("\n") ? 1 : 0));
  const truncated = end < text.length;

  return {
    content,
    lineStart,
    lineEnd: Math.max(lineStart, lineEnd),
    totalLines,
    nextLine: truncated && !midLine ? Math.max(lineStart, lineEnd) + 1 : null,
    nextOffset: truncated ? end : null,
    truncated,
  };
}

const IMPORT_PATTERN =
  /^\s*(?:import\b|from\s+\S+\s+import\b|const\s+\S+\s*=\s*require\(|require\(|#include\b|use\s+\S+|export\s+\*\s+from\b)/;

const SYMBOL_PATTERN =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|abstract\s+|async\s+)*(?:function|class|interface|type|enum|namespace|module|struct|impl|trait|union|def|func|fn|sub|package|record|protocol|extension)\b|^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*[:=]|^(?:public|private|protected)\s+[A-Za-z_$][\w$]*\s*\(/;

const MAX_OUTLINE_ENTRIES = 80;
const MAX_OUTLINE_LINE_CHARS = 160;

function pushBounded(target: string[], line: string): void {
  if (target.length >= MAX_OUTLINE_ENTRIES) return;
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OUTLINE_LINE_CHARS) return;
  if (target.includes(trimmed)) return;
  target.push(trimmed);
}

/**
 * Cheap structural summary used when a text attachment is too large to inline.
 * Regex-based on purpose: it must stay dependency-free and cannot fail the
 * Turn, and the model can always read the real text afterwards.
 */
export function sourceOutline(text: string, filename: string): string {
  const extension = filename.toLowerCase().split(".").at(-1) ?? "";
  const lines = text.split("\n");
  const imports: string[] = [];
  const symbols: string[] = [];

  if (extension === "md" || extension === "markdown" || extension === "rst") {
    for (const line of lines) {
      if (/^#{1,6}\s+\S/.test(line)) pushBounded(symbols, line);
    }
  } else if (
    extension === "css" ||
    extension === "scss" ||
    extension === "sass" ||
    extension === "less"
  ) {
    for (const line of lines) {
      if (/^[^\s@/][^{}]*\{$/.test(line)) pushBounded(symbols, line.replace(/\s*\{$/, ""));
      else if (/^@(media|supports|font-face|keyframes|import)\b/.test(line))
        pushBounded(symbols, line);
    }
  } else if (
    extension === "html" ||
    extension === "htm" ||
    extension === "vue" ||
    extension === "svelte"
  ) {
    for (const line of lines) {
      if (
        /<(script|style|template|main|header|footer|section|nav|form|table|dialog)\b/i.test(line)
      ) {
        pushBounded(symbols, line);
      }
    }
  } else {
    for (const line of lines) {
      if (IMPORT_PATTERN.test(line)) pushBounded(imports, line);
      else if (SYMBOL_PATTERN.test(line)) pushBounded(symbols, line);
    }
  }

  const body: string[] = [
    `lines: ${sourceLineCount(text)}; characters: ${text.length}`,
    "This attachment is larger than the inline budget. Read it with read_attachment view=source.",
  ];
  if (imports.length > 0) body.push("imports:", ...imports.map((line) => `- ${line}`));
  if (symbols.length > 0) body.push("symbols:", ...symbols.map((line) => `- ${line}`));
  if (imports.length === 0 && symbols.length === 0) {
    body.push("No structural outline was detected; read the source by line range.");
  }
  return body.join("\n");
}
