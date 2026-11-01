export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    const bucket = this.buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
    }

    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
    }

    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count, retryAfterMs: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number): void {
    if (this.buckets.size <= this.maxEntries) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
