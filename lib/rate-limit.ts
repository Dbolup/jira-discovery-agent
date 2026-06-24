/**
 * Best-effort in-memory IP rate limiter (sliding window).
 *
 * NOTE: Serverless instances are ephemeral and not shared, so this caps abuse
 * per warm instance rather than globally. It is enough to blunt casual bot/scraper
 * abuse of your API key. For strict global limits, swap the Map for Vercel KV /
 * Upstash Redis (see README) — the function signature stays the same.
 */

const MAX = Number(process.env.RATE_LIMIT_MAX ?? 20);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);

const hits = new Map<string, number[]>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (hits.get(ip) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX) {
    const oldest = timestamps[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000)
    );
    hits.set(ip, timestamps);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  timestamps.push(now);
  hits.set(ip, timestamps);

  // Opportunistic cleanup so the Map doesn't grow unbounded on a warm instance.
  if (hits.size > 5000) {
    for (const [key, ts] of hits) {
      const live = ts.filter((t) => t > windowStart);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return { allowed: true, remaining: MAX - timestamps.length, retryAfterSeconds: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
