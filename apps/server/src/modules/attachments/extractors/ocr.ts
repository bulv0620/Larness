import { existsSync } from "node:fs";
import path from "node:path";
import { AttachmentError } from "../types.js";

export type ImageTranscriber = (input: {
  bytes: Buffer;
  mime: string;
}) => Promise<{ text: string; warning?: string }>;

/**
 * Local OCR is opt-in: without a local language-data directory the bundled
 * tesseract.js would download models, which the attachment contract forbids.
 */
export function tesseractLanguagePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.LARNESS_TESSERACT_LANG_PATH?.trim();
  if (!configured) return null;
  return path.resolve(configured);
}

export function ocrAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const directory = tesseractLanguagePath(env);
  if (directory === null) return false;
  return (
    existsSync(path.join(directory, "eng.traineddata")) ||
    existsSync(path.join(directory, "eng.traineddata.gz"))
  );
}

export function createLocalOcrTranscriber(env: NodeJS.ProcessEnv = process.env): ImageTranscriber {
  return async ({ bytes }) => {
    const directory = tesseractLanguagePath(env);
    if (directory === null || !ocrAvailable(env)) {
      throw new AttachmentError(
        "ATTACHMENT_VISION_UNAVAILABLE",
        "local OCR language data is not installed",
      );
    }
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      langPath: directory,
      gzip: true,
      logger: () => undefined,
    });
    try {
      const result = await worker.recognize(bytes);
      const text = result.data.text.trim();
      if (text.length === 0) {
        throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "OCR produced no text");
      }
      return { text };
    } finally {
      await worker.terminate();
    }
  };
}
