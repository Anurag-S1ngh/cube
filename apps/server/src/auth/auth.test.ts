import { describe, expect, test } from "bun:test";

import { generateApiKey, hashApiKey } from "./apiKeys";
import { hashPassword, verifyPassword } from "./password";
import { checkRateLimit, resetRateLimit } from "./rateLimit";

describe("password", () => {
	test("verifies a correct password and rejects a wrong one", async () => {
		const hash = await hashPassword("correct horse battery staple");
		expect(await verifyPassword("correct horse battery staple", hash)).toBe(
			true,
		);
		expect(await verifyPassword("wrong", hash)).toBe(false);
	});

	test("treats a null hash as unverifiable", async () => {
		expect(await verifyPassword("anything", null)).toBe(false);
	});

	test("salts hashes so equal passwords differ", async () => {
		const a = await hashPassword("same");
		const b = await hashPassword("same");
		expect(a).not.toBe(b);
	});
});

describe("api keys", () => {
	test("generates prefixed keys whose hash matches hashApiKey", () => {
		const { raw, keyPrefix, keyHash } = generateApiKey();
		expect(raw.startsWith("cube_")).toBe(true);
		expect(keyPrefix.startsWith("cube_")).toBe(true);
		expect(raw.startsWith(`${keyPrefix}_`)).toBe(true);
		expect(keyHash).toBe(hashApiKey(raw));
	});

	test("two generated keys are unique", () => {
		expect(generateApiKey().raw).not.toBe(generateApiKey().raw);
	});
});

describe("rate limit", () => {
	test("allows up to max then blocks", () => {
		const key = `test:${Math.random()}`;
		for (let i = 0; i < 3; i += 1) {
			expect(checkRateLimit(key, { max: 3, windowMs: 1000 }).allowed).toBe(
				true,
			);
		}
		const blocked = checkRateLimit(key, { max: 3, windowMs: 1000 });
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterMs).toBeGreaterThan(0);
	});

	test("reset clears the bucket", () => {
		const key = `test:${Math.random()}`;
		checkRateLimit(key, { max: 1, windowMs: 1000 });
		expect(checkRateLimit(key, { max: 1, windowMs: 1000 }).allowed).toBe(false);
		resetRateLimit(key);
		expect(checkRateLimit(key, { max: 1, windowMs: 1000 }).allowed).toBe(true);
	});
});
