import mammoth from "mammoth";
import TurndownService from "turndown";
import { inspectZip } from "../mime.js";
import {
  AttachmentError,
  type DocumentExtractor,
  type ExtractedAttachment,
  type ExtractInput,
} from "../types.js";
import { finishExtraction } from "./common.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.addRule("image", {
  filter: "img",
  replacement: (_content, node) =>
    `[image: ${(node as HTMLElement).getAttribute("alt") ?? "embedded"}]`,
});

export const docxExtractor: DocumentExtractor = {
  id: "mammoth",
  version: "1",
  supports: (mime) =>
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    inspectZip(input.bytes, {
      maxEntries: input.limits.maxZipEntries,
      maxEntryUncompressed: input.limits.maxZipEntryBytes,
      maxTotalUncompressed: input.limits.maxZipTotalBytes,
    });

    let html: string;
    try {
      const result = await mammoth.convertToHtml({ buffer: input.bytes });
      html = result.value;
    } catch {
      throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "DOCX could not be parsed");
    }

    const markdown = turndown.turndown(html);
    return finishExtraction(input, {
      markdown,
      method: "native",
      pageCount: null,
      extractor: { id: this.id, version: this.version },
    });
  },
};
