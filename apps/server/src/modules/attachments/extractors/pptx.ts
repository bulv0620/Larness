import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { inspectZip } from "../mime.js";
import {
  AttachmentError,
  type DocumentExtractor,
  type ExtractedAttachment,
  type ExtractInput,
} from "../types.js";
import { finishExtraction } from "./common.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

function collectText(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length > 0) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "a:t" || key === "t" || key.endsWith(":t")) {
        const text =
          typeof entry === "string" ? entry : Array.isArray(entry) ? entry.join(" ") : "";
        if (text.trim().length > 0) output.push(text.trim());
      } else {
        collectText(entry, output);
      }
    }
  }
}

function slideNumber(name: string, pattern: RegExp): number | null {
  const match = pattern.exec(name);
  return match ? Number(match[1]) : null;
}

export const pptxExtractor: DocumentExtractor = {
  id: "pptx-xml",
  version: "1",
  supports: (mime) =>
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    inspectZip(input.bytes, {
      maxEntries: input.limits.maxZipEntries,
      maxEntryUncompressed: input.limits.maxZipEntryBytes,
      maxTotalUncompressed: input.limits.maxZipTotalBytes,
    });
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(input.bytes);
    } catch {
      throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "PPTX could not be opened");
    }

    const slides = Object.keys(zip.files)
      .map((name) => ({ name, number: slideNumber(name, /^ppt\/slides\/slide(\d+)\.xml$/) }))
      .filter((entry): entry is { name: string; number: number } => entry.number !== null)
      .sort((left, right) => left.number - right.number);

    if (slides.length === 0) {
      throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "PPTX has no slides");
    }

    const parts: string[] = [];
    const warnings: string[] = [];
    for (const slide of slides) {
      const xml = await zip.file(slide.name)?.async("string");
      if (xml === undefined) continue;
      const texts: string[] = [];
      try {
        collectText(parser.parse(xml), texts);
      } catch {
        warnings.push(`slide ${slide.number} could not be parsed`);
        continue;
      }
      let body = `## Slide ${slide.number}\n\n${texts.join("\n")}`.trimEnd();
      const notesFile = zip.file(`ppt/notesSlides/notesSlide${slide.number}.xml`);
      if (notesFile !== null) {
        const notesTexts: string[] = [];
        try {
          collectText(parser.parse(await notesFile.async("string")), notesTexts);
        } catch {
          warnings.push(`slide ${slide.number} notes could not be parsed`);
        }
        if (notesTexts.length > 0) body += `\n\n> Notes: ${notesTexts.join(" ")}`;
      }
      parts.push(body);
    }

    return finishExtraction(input, {
      markdown: parts.join("\n\n"),
      method: "native",
      pageCount: slides.length,
      warnings,
      extractor: { id: this.id, version: this.version },
    });
  },
};
