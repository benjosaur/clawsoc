/**
 * In-memory token bucket rate limiter, keyed by IP address.
 */

class TokenBucket {
  tokens: number;
  lastRefill: number;

  constructor(
    public readonly capacity: number,
    public readonly refillRate: number, // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Seconds until 1 token is available. */
  retryAfter(): number {
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }
}

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number,
    cleanupIntervalMs = 60_000,
    private readonly staleMs = 300_000, // 5 min
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /** Returns true if allowed, false if rate-limited. */
  consume(ip: string): boolean {
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillRate);
      this.buckets.set(ip, bucket);
    }
    return bucket.consume();
  }

  /** Seconds until the IP can make another request. */
  retryAfter(ip: string): number {
    return this.buckets.get(ip)?.retryAfter() ?? 0;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.staleMs;
    for (const [ip, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) this.buckets.delete(ip);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

/** General agent API endpoints: 30 req/min per IP */
export const agentApiLimiter = new RateLimiter(30, 0.5);

/** Registration/check-username: 10 req/min per IP */
export const registerLimiter = new RateLimiter(10, 10 / 60);
