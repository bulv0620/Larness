import { ExtractorRegistry } from "./extractors/registry.js";
import { AttachmentError, type ExtractedAttachment, type ExtractInput } from "./types.js";

export const extractorRegistry = new ExtractorRegistry();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AttachmentError("ATTACHMENT_PARSE_TIMEOUT", "attachment extraction timed out"));
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new AttachmentError("ATTACHMENT_PARSE_TIMEOUT", "attachment extraction was cancelled"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Runs one extractor with the configured bounds. v1 executes in-process with a
 * hard timeout and pre-decompression limits; see 088 acceptance for the known
 * worker-isolation gap.
 */
export async function extractAttachment(
  registry: ExtractorRegistry,
  input: ExtractInput,
): Promise<ExtractedAttachment> {
  if (input.bytes.length > input.limits.maxBytes) {
    throw new AttachmentError("ATTACHMENT_TOO_LARGE", "attachment exceeds the size limit");
  }
  const extractor = registry.resolve(input.mime);
  if (extractor === null) {
    throw new AttachmentError("ATTACHMENT_UNSUPPORTED", "no extractor supports this type");
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await withTimeout(
      extractor.extract({ ...input, signal: controller.signal }),
      input.limits.timeoutMs,
      controller.signal,
    );
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError("ATTACHMENT_PARSE_FAILED", "attachment could not be parsed");
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
}
