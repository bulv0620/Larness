import { estimateTextTokens } from "../../agent/tokenEstimator.js";
import type { AttachmentSection, ExtractedAttachment, ExtractInput } from "../types.js";

export interface SectionDraft {
  anchor: string;
  title: string;
  page?: number;
  text: string;
}

export function clampExtracted(
  markdown: string,
  maxChars: number,
): {
  markdown: string;
  warnings: string[];
} {
  if (markdown.length <= maxChars) return { markdown, warnings: [] };
  return {
    markdown: `${markdown.slice(0, maxChars)}\n\n[truncated: extracted text exceeded ${maxChars} characters]`,
    warnings: [`extracted text truncated at ${maxChars} characters`],
  };
}

export function sectionsFromMarkdown(markdown: string): AttachmentSection[] {
  const lines = markdown.split("\n");
  const sections: AttachmentSection[] = [];
  let title = "start";
  let anchor = "offset:0";
  let page: number | undefined;
  let offset = 0;
  let body: string[] = [];

  const flush = (nextOffset: number) => {
    const text = body.join("\n").trim();
    if (text.length === 0 && sections.length > 0) return;
    sections.push({
      anchor,
      title: title.slice(0, 200),
      ...(page === undefined ? {} : { page }),
      tokens: estimateTextTokens(text),
    });
    offset = nextOffset;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const pageMatch = /^<!-- page: (\d+) -->$/.exec(line);
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (pageMatch || heading) {
      flush(offset);
      body = [];
      if (pageMatch) {
        page = Number(pageMatch[1]);
        title = `Page ${page}`;
        anchor = `page:${page}`;
      } else if (heading) {
        title = heading[2]?.trim() ?? "section";
        anchor = `heading:${title}`;
        page = undefined;
      }
    }
    body.push(line);
    offset += line.length + 1;
  }
  flush(offset);
  return sections.slice(0, 500);
}

export function chunkMarkdownSections(markdown: string, chunkChars = 8_000): AttachmentSection[] {
  const headings = sectionsFromMarkdown(markdown);
  if (headings.length > 1 || (headings[0]?.tokens ?? 0) <= 2_000) return headings;
  const sections: AttachmentSection[] = [];
  for (let start = 0; start < markdown.length; start += chunkChars) {
    const text = markdown.slice(start, start + chunkChars);
    sections.push({
      anchor: `offset:${start}`,
      title: `Characters ${start}–${start + text.length}`,
      tokens: estimateTextTokens(text),
    });
    if (sections.length >= 500) break;
  }
  return sections;
}

export function finishExtraction(
  input: ExtractInput,
  parts: {
    markdown: string;
    method: ExtractedAttachment["method"];
    pageCount: number | null;
    warnings?: string[];
    extractor: ExtractedAttachment["extractor"];
  },
): ExtractedAttachment {
  const clamped = clampExtracted(parts.markdown.trim(), input.limits.maxExtractedChars);
  const warnings = [...(parts.warnings ?? []), ...clamped.warnings];
  return {
    markdown: clamped.markdown,
    method: parts.method,
    pageCount: parts.pageCount,
    sections: chunkMarkdownSections(clamped.markdown),
    warnings,
    extractor: parts.extractor,
  };
}

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
