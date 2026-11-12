export function relativeTime(timestamp: number, base = Date.now()): string {
  const diff = Math.max(0, base - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function uptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export interface BytesPairParts {
  used: string;
  total: string;
}

/** Formats used / total bytes into separate display strings sharing the largest common unit. */
export function formatBytesPairParts(usedBytes: number, totalBytes: number): BytesPairParts | null {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }

  const used = Math.max(0, usedBytes);
  const gib = 1024 ** 3;

  if (totalBytes >= 1024 * gib) {
    const tib = 1024 * gib;
    return { used: `${(used / tib).toFixed(1)}`, total: `${(totalBytes / tib).toFixed(1)} TB` };
  }

  if (totalBytes >= 100 * gib) {
    return { used: `${Math.round(used / gib)}`, total: `${Math.round(totalBytes / gib)} GB` };
  }

  const totalDecimals = totalBytes >= 10 * gib ? 0 : 1;
  return {
    used: `${(used / gib).toFixed(1)}`,
    total: `${(totalBytes / gib).toFixed(totalDecimals)} GB`,
  };
}

/** Formats a used / total byte pair in the largest unit shared by both values. */
export function formatBytesPair(usedBytes: number, totalBytes: number): string {
  const parts = formatBytesPairParts(usedBytes, totalBytes);
  return parts === null ? "—" : `${parts.used} / ${parts.total}`;
}

export function usedPercent(usedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100));
}
