import { describe, expect, test } from "bun:test";

import { Cube } from "./client";
import { CubeError } from "./errors";
import { signWebhook, verifyWebhookSignature } from "./webhooks";

type Captured = { url: string; init: RequestInit };

function client(handler: (captured: Captured) => Response): {
	cube: Cube;
	calls: Captured[];
} {
	const calls: Captured[] = [];
	const cube = new Cube({
		apiKey: "cube_test_key",
		baseUrl: "http://api.test",
		maxRetries: 2,
		fetch: (async (url: string | URL, init?: RequestInit) => {
			const captured = { url: url.toString(), init: init ?? {} };
			calls.push(captured);
			return handler(captured);
		}) as unknown as typeof fetch,
	});
	return { cube, calls };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("Cube client", () => {
	test("authenticates and sends an idempotency key", async () => {
		const { cube, calls } = client(() => json({ ok: true }));
		await cube.events.failedPayment({
			customerExternalId: "cus_1",
			amountCents: 100,
			declineCode: "insufficient_funds",
		});
		const { url, init } = calls[0] as Captured;
		expect(url).toBe("http://api.test/events/failed-payment");
		expect(init.method).toBe("POST");
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer cube_test_key");
		expect(headers["idempotency-key"]).toBeTruthy();
	});

	test("honours a provided idempotency key", async () => {
		const { cube, calls } = client(() => json({ ok: true }));
		await cube.events.failedPayment(
			{
				customerExternalId: "cus_1",
				amountCents: 100,
				declineCode: "generic_decline",
			},
			{ idempotencyKey: "abc" },
		);
		const headers = (calls[0] as Captured).init.headers as Record<
			string,
			string
		>;
		expect(headers["idempotency-key"]).toBe("abc");
	});

	test("builds a query string for list", async () => {
		const { cube, calls } = client(() =>
			json({ investigations: [], total: 0 }),
		);
		await cube.investigations.list({ status: "escalated", page: 2 });
		expect(calls[0]?.url).toBe(
			"http://api.test/investigations?status=escalated&page=2",
		);
	});

	test("retries on 500 then succeeds", async () => {
		let n = 0;
		const { cube, calls } = client(() => {
			n += 1;
			return n < 2 ? json({ error: "boom" }, 500) : json({ ok: true });
		});
		const result = await cube.investigations.get("abc");
		expect(result).toEqual({ ok: true });
		expect(calls.length).toBe(2);
	});

	test("throws CubeError with the server message", async () => {
		const { cube } = client(() => json({ error: "unknown customer" }, 422));
		await expect(cube.investigations.approve("x")).rejects.toMatchObject({
			name: "CubeError",
			status: 422,
			message: "unknown customer",
		});
		await expect(cube.investigations.approve("x")).rejects.toBeInstanceOf(
			CubeError,
		);
	});
});

describe("webhook signatures", () => {
	test("round-trips sign/verify and rejects tampering", () => {
		const body = JSON.stringify({ event: "investigation.resolved" });
		const header = signWebhook(body, "whsec_test");
		expect(verifyWebhookSignature(body, header, "whsec_test")).toBe(true);
		expect(verifyWebhookSignature(`${body} `, header, "whsec_test")).toBe(
			false,
		);
		expect(verifyWebhookSignature(body, header, "wrong")).toBe(false);
	});
});
