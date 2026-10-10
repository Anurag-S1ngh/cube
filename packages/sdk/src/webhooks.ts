import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Sign an outbound Cube webhook body the way Cube does. Useful in tests and for
 * re-emitting: `t=<unix seconds>,v1=<hmac-sha256 of "t.body">`.
 */
export function signWebhook(
	body: string,
	secret: string,
	timestamp: number = Math.floor(Date.now() / 1000),
): string {
	const signature = createHmac("sha256", secret)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	return `t=${timestamp},v1=${signature}`;
}

/**
 * Verify a `Cube-Signature` header on an incoming Cube webhook. Enforces a
 * timestamp tolerance to blunt replay attacks.
 */
export function verifyWebhookSignature(
	body: string,
	header: string,
	secret: string,
	toleranceSeconds = 300,
): boolean {
	const parts: Record<string, string> = {};
	for (const segment of header.split(",")) {
		const index = segment.indexOf("=");
		if (index === -1) continue;
		parts[segment.slice(0, index).trim()] = segment.slice(index + 1).trim();
	}
	const timestamp = Number(parts.t);
	const provided = parts.v1;
	if (!timestamp || !provided) return false;
	if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) {
		return false;
	}
	const expected = createHmac("sha256", secret)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	return safeEqual(expected, provided);
}

/**
 * Verify a plain hex HMAC-SHA256 signature over the raw body (e.g. a payment
 * provider like Stripe or the mock provider) before forwarding to Cube.
 */
export function verifyHmacSignature(
	body: string,
	signature: string | undefined,
	secret: string,
): boolean {
	if (!signature) return false;
	const expected = createHmac("sha256", secret).update(body).digest("hex");
	return safeEqual(expected, signature);
}
