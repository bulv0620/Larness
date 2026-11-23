import type { DocumentExtractor, ExtractedAttachment, ExtractInput } from "../types.js";
import { escapeMarkdownCell, finishExtraction } from "./common.js";

export const MAX_CSV_ROWS = 5_000;
export const MAX_CSV_COLUMNS = 200;
const MAX_FIELD_CHARS = 20_000;

/** RFC4180-style parser with explicit row/column caps. */
export function parseCsv(source: string): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;

  const pushField = () => {
    row.push(field.slice(0, MAX_FIELD_CHARS));
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (rows.length < MAX_CSV_ROWS) rows.push(row.slice(0, MAX_CSV_COLUMNS));
    else truncated = true;
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
    if (row.length >= MAX_CSV_COLUMNS) {
      truncated = true;
      // Flush the row and skip to the next line rather than buffering more.
      pushRow();
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return { rows, truncated };
}

export const csvExtractor: DocumentExtractor = {
  id: "csv",
  version: "1",
  supports: (mime) => mime === "text/csv",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    const { rows, truncated } = parseCsv(input.bytes.toString("utf8").replace(/^\uFEFF/, ""));
    const width = Math.max(0, ...rows.map((row) => row.length));
    const warnings: string[] = [];
    if (truncated)
      warnings.push(`CSV truncated at ${MAX_CSV_ROWS} rows / ${MAX_CSV_COLUMNS} columns`);
    const [header = [], ...body] = rows;
    const lines: string[] = [];
    if (width > 0 && header.length > 0) {
      lines.push(
        `| ${Array.from({ length: width }, (_, index) => escapeMarkdownCell(header[index] ?? "")).join(" | ")} |`,
      );
      lines.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
      for (const row of body) {
        lines.push(
          `| ${Array.from({ length: width }, (_, index) => escapeMarkdownCell(row[index] ?? "")).join(" | ")} |`,
        );
      }
    }
    return finishExtraction(input, {
      markdown: lines.join("\n"),
      method: "native",
      pageCount: null,
      warnings,
      extractor: { id: this.id, version: this.version },
    });
  },
};
