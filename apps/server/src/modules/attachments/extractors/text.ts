import type { DocumentExtractor, ExtractedAttachment, ExtractInput } from "../types.js";
import { finishExtraction } from "./common.js";

function decodeText(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}

export const textExtractor: DocumentExtractor = {
  id: "text",
  version: "1",
  supports: (mime) => mime === "text/plain" || mime === "text/markdown",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    const markdown = decodeText(input.bytes).replace(/\r\n?/g, "\n");
    return finishExtraction(input, {
      markdown,
      method: "native",
      pageCount: null,
      extractor: { id: this.id, version: this.version },
    });
  },
};
