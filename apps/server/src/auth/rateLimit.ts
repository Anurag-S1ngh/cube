/**
 * Tiny in-process sliding-window limiter. Good enough to blunt credential
 * stuffing on a single instance; swap for Redis when running more than one.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export function checkRateLimit(
	key: string,
	options: { max: number; windowMs: number },
): RateLimitResult {
	const now = Date.now();

	if (buckets.size > MAX_BUCKETS) {
		for (const [k, bucket] of buckets) {
			if (bucket.resetAt <= now) buckets.delete(k);
		}
	}

	const bucket = buckets.get(key);
	if (!bucket || bucket.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + options.windowMs });
		return { allowed: true, retryAfterMs: 0 };
	}

	if (bucket.count >= options.max) {
		return { allowed: false, retryAfterMs: bucket.resetAt - now };
	}

	bucket.count += 1;
	return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string): void {
	buckets.delete(key);
}
