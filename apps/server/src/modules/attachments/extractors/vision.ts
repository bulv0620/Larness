import type { ImageTranscriber } from "./ocr.js";

/**
 * Cloud vision transcription is only enabled when the caller supplies an
 * explicit connection and transcriber. There is deliberately no fallback to a
 * different provider.
 */
export interface VisionTranscriptionConfig {
  connectionId: string | null;
  transcriber: ImageTranscriber | null;
}

export function visionAvailable(config: VisionTranscriptionConfig): boolean {
  return config.connectionId !== null && config.transcriber !== null;
}
