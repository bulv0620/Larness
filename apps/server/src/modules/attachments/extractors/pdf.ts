import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  AttachmentError,
  type DocumentExtractor,
  type ExtractedAttachment,
  type ExtractInput,
} from "../types.js";
import { finishExtraction } from "./common.js";

function isPasswordError(error: unknown): boolean {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  return (
    candidate?.name === "PasswordException" ||
    candidate?.code === 1 ||
    /password/i.test(typeof candidate?.message === "string" ? candidate.message : "")
  );
}

export const pdfExtractor: DocumentExtractor = {
  id: "pdfjs",
  version: "5",
  supports: (mime) => mime === "application/pdf",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    const task = getDocument({
      data: Uint8Array.from(input.bytes),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });

    let document: PDFDocumentProxy;
    try {
      document = await task.promise;
    } catch (error) {
      if (isPasswordError(error)) {
        throw new AttachmentError("ATTACHMENT_ENCRYPTED", "PDF is encrypted");
      }
      throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "PDF could not be parsed");
    }

    try {
      if (document.numPages > input.limits.maxPdfPages) {
        throw new AttachmentError("ATTACHMENT_LIMIT", "PDF exceeds the page limit");
      }
      const pages: string[] = [];
      const warnings: string[] = [];
      let emptyPages = 0;

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        if (input.signal?.aborted === true) {
          throw new AttachmentError("ATTACHMENT_PARSE_TIMEOUT", "PDF extraction was cancelled");
        }
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, "\n")
          .trim();
        if (text.length === 0) {
          emptyPages += 1;
          warnings.push(`page ${pageNumber} has no text layer`);
        } else {
          pages.push(`<!-- page: ${pageNumber} -->\n\n${text}`);
        }
        page.cleanup();
      }

      if (pages.length === 0) {
        throw new AttachmentError("ATTACHMENT_PDF_NO_TEXT", "PDF has no extractable text layer");
      }
      if (emptyPages > 0) {
        warnings.unshift(`${emptyPages} of ${document.numPages} page(s) had no text layer`);
      }
      return finishExtraction(input, {
        markdown: pages.join("\n\n"),
        method: "text-layer",
        pageCount: document.numPages,
        warnings: warnings.slice(0, 50),
        extractor: { id: this.id, version: this.version },
      });
    } finally {
      await task.destroy();
    }
  },
};
