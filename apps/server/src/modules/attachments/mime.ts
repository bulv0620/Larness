import type { AttachmentKind } from "../../db/schema.js";
import { AttachmentError } from "./types.js";

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
  symlink: boolean;
  directory: boolean;
}

export interface ZipInspection {
  entries: ZipEntryInfo[];
  totalUncompressed: number;
}

export interface SniffedAttachment {
  mime: string;
  kind: AttachmentKind;
  extension: string;
  zip: ZipInspection | null;
}

const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_MAX_COMMENT = 0xffff;

export interface ZipLimits {
  maxEntries: number;
  maxEntryUncompressed: number;
  maxTotalUncompressed: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2_000,
  maxEntryUncompressed: 64 * 1024 * 1024,
  maxTotalUncompressed: 128 * 1024 * 1024,
};

function findEndOfCentralDirectory(bytes: Buffer): number {
  const stop = Math.max(0, bytes.length - ZIP_MAX_COMMENT - 22);
  for (let offset = bytes.length - 22; offset >= stop; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_SIGNATURE) return offset;
  }
  return -1;
}

function decodeName(bytes: Buffer, start: number, length: number, utf8: boolean): string {
  return bytes.subarray(start, start + length).toString(utf8 ? "utf8" : "latin1");
}

function safeEntryName(name: string): boolean {
  const candidate = name.endsWith("/") ? name.slice(0, -1) : name;
  if (candidate.length === 0 || name.length > 1_024) return false;
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/")) return false;
  return !candidate.split("/").some((segment) => segment === ".." || segment === "");
}

/**
 * Reads the central directory without trusting the archive. It rejects
 * encrypted entries, traversal names, symlinks and oversized expansion before
 * any decompression happens.
 */
export function inspectZip(bytes: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipInspection {
  if (bytes.length < 22) throw unsupported("truncated archive");
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) throw unsupported("missing zip directory");

  const entryCount = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (
    entryCount > limits.maxEntries ||
    directoryOffset + directorySize > bytes.length ||
    directoryOffset > end
  ) {
    throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "archive exceeds attachment limits");
  }

  const entries: ZipEntryInfo[] = [];
  let totalUncompressed = 0;
  let offset = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw unsupported("invalid zip directory");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const name = decodeName(bytes, offset + 46, nameLength, (flags & 0x800) !== 0);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const entry: ZipEntryInfo = {
      name,
      compressedSize,
      uncompressedSize,
      encrypted: (flags & 0x1) !== 0,
      symlink: (unixMode & 0o170000) === 0o120000,
      directory: name.endsWith("/") || (unixMode & 0o170000) === 0o040000,
    };

    if (!safeEntryName(name)) {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "archive contains an unsafe path");
    }
    if (entry.encrypted) {
      throw new AttachmentError("ATTACHMENT_ENCRYPTED", "archive is encrypted");
    }
    if (entry.symlink) {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "archive contains a symbolic link");
    }
    if (uncompressedSize > limits.maxEntryUncompressed) {
      throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "archive entry is too large");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressed) {
      throw new AttachmentError(
        "ATTACHMENT_UNSUPPORTED",
        "archive expands beyond attachment limits",
      );
    }
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (!entries.some((entry) => entry.name === "[Content_Types].xml")) {
    throw unsupported("missing office content types");
  }
  return { entries, totalUncompressed };
}

function unsupported(message: string): AttachmentError {
  return new AttachmentError("ATTACHMENT_UNSUPPORTED", message);
}

function isText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) return false;
  // Reject invalid UTF-8 instead of guessing a legacy encoding.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function officeMime(entries: ZipEntryInfo[]): string | null {
  const names = entries.map((entry) => entry.name);
  if (names.some((name) => name.startsWith("word/"))) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (names.some((name) => name.startsWith("ppt/"))) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (names.some((name) => name.startsWith("xl/"))) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
}

function htmlMime(text: string, declared: string | null, filename: string): boolean {
  const head = text.slice(0, 4_096).toLowerCase();
  if (/^\s*(<!doctype html|<html|<head|<body)/.test(head)) return true;
  if (declared === "text/html") return true;
  return /\.html?$/i.test(filename) && /<(html|body|div|p|script)[\s>]/.test(head);
}

/**
 * Magic-number first, client hint second. The returned MIME is authoritative;
 * callers must not trust the client declaration when they disagree.
 */
const BANNED_EXTENSION =
  /\.(exe|dll|so|dylib|bat|cmd|ps1|sh|js|mjs|cjs|jar|msi|apk|svg|zip|rar|7z|gz|tar|doc|ppt|xls|mp3|mp4|mov|avi|wav|ogg)$/i;

export function sniffAttachment(
  bytes: Buffer,
  declaredMime: string | null,
  filename: string,
): SniffedAttachment {
  const declared = declaredMime?.split(";")[0]?.trim().toLowerCase() ?? null;
  if (BANNED_EXTENSION.test(filename)) {
    throw unsupported("file type is not supported");
  }

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { mime: "image/png", kind: "image", extension: "png", zip: null };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", kind: "image", extension: "jpg", zip: null };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", kind: "image", extension: "webp", zip: null };
  }
  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") {
    return { mime: "application/pdf", kind: "document", extension: "pdf", zip: null };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    const zip = inspectZip(bytes);
    const mime = officeMime(zip.entries);
    if (mime === null) throw unsupported("unsupported zip container");
    return {
      mime,
      kind: "document",
      extension: mime.includes("wordprocessing")
        ? "docx"
        : mime.includes("presentation")
          ? "pptx"
          : "xlsx",
      zip,
    };
  }
  // SVG is banned in v1; detect it before the generic text branch.
  if (/<svg[\s>]/i.test(bytes.subarray(0, 2_048).toString("utf8"))) {
    throw unsupported("SVG attachments are not supported");
  }
  if (isText(bytes)) {
    const text = bytes.subarray(0, Math.min(bytes.length, 65_536)).toString("utf8");
    if (htmlMime(text, declared, filename)) {
      return { mime: "text/html", kind: "document", extension: "html", zip: null };
    }
    if (declared === "text/csv" || /\.csv$/i.test(filename)) {
      return { mime: "text/csv", kind: "document", extension: "csv", zip: null };
    }
    if (declared === "text/markdown" || /\.(md|markdown)$/i.test(filename)) {
      return { mime: "text/markdown", kind: "document", extension: "md", zip: null };
    }
    return { mime: "text/plain", kind: "document", extension: "txt", zip: null };
  }
  throw unsupported("unsupported attachment type");
}
