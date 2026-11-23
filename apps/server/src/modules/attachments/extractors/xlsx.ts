import ExcelJS from "exceljs";
import { inspectZip } from "../mime.js";
import {
  AttachmentError,
  type DocumentExtractor,
  type ExtractedAttachment,
  type ExtractInput,
} from "../types.js";
import { escapeMarkdownCell, finishExtraction } from "./common.js";

const MAX_SHEETS = 20;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 100;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("error" in value) return `#${String(value.error)}`;
  }
  return "";
}

export const xlsxExtractor: DocumentExtractor = {
  id: "exceljs",
  version: "1",
  supports: (mime) => mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    inspectZip(input.bytes, {
      maxEntries: input.limits.maxZipEntries,
      maxEntryUncompressed: input.limits.maxZipEntryBytes,
      maxTotalUncompressed: input.limits.maxZipTotalBytes,
    });
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(input.bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "XLSX could not be parsed");
    }

    const warnings: string[] = [];
    const sheets = workbook.worksheets.slice(0, MAX_SHEETS);
    if (workbook.worksheets.length > MAX_SHEETS) {
      warnings.push(`only the first ${MAX_SHEETS} sheets were extracted`);
    }

    const parts: string[] = [];
    for (const sheet of sheets) {
      const rowCount = Math.min(sheet.rowCount, MAX_ROWS);
      const columnCount = Math.min(sheet.columnCount, MAX_COLUMNS);
      if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS) {
        warnings.push(`sheet ${sheet.name} truncated to ${rowCount} rows / ${columnCount} columns`);
      }
      const rows: string[][] = [];
      for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
        const row = sheet.getRow(rowIndex);
        const values: string[] = [];
        for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
          values.push(escapeMarkdownCell(cellText(row.getCell(columnIndex).value)));
        }
        if (values.some((value) => value.length > 0)) rows.push(values);
      }
      if (rows.length === 0) continue;
      const lines = [`## Sheet: ${sheet.name}`, ""];
      lines.push(`| ${rows[0]?.join(" | ") ?? ""} |`);
      lines.push(`| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`);
      for (const row of rows.slice(1)) lines.push(`| ${row.join(" | ")} |`);
      parts.push(lines.join("\n"));
    }

    if (parts.length === 0) {
      throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "XLSX has no readable cells");
    }
    return finishExtraction(input, {
      markdown: parts.join("\n\n"),
      method: "native",
      pageCount: sheets.length,
      warnings,
      extractor: { id: this.id, version: this.version },
    });
  },
};
