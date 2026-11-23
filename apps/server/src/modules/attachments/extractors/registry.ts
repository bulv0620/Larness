import type { DocumentExtractor } from "../types.js";
import { csvExtractor } from "./csv.js";
import { docxExtractor } from "./docx.js";
import { htmlExtractor } from "./html.js";
import { pdfExtractor } from "./pdf.js";
import { pptxExtractor } from "./pptx.js";
import { textExtractor } from "./text.js";
import { xlsxExtractor } from "./xlsx.js";

export const DEFAULT_EXTRACTORS: readonly DocumentExtractor[] = [
  textExtractor,
  csvExtractor,
  htmlExtractor,
  pdfExtractor,
  docxExtractor,
  pptxExtractor,
  xlsxExtractor,
];

export class ExtractorRegistry {
  readonly #extractors: DocumentExtractor[];

  constructor(extractors: readonly DocumentExtractor[] = DEFAULT_EXTRACTORS) {
    this.#extractors = [...extractors];
  }

  register(extractor: DocumentExtractor): void {
    this.#extractors.push(extractor);
  }

  resolve(mime: string): DocumentExtractor | null {
    return this.#extractors.find((extractor) => extractor.supports(mime)) ?? null;
  }

  list(): readonly DocumentExtractor[] {
    return this.#extractors;
  }
}

export {
  csvExtractor,
  docxExtractor,
  htmlExtractor,
  pdfExtractor,
  pptxExtractor,
  textExtractor,
  xlsxExtractor,
};
