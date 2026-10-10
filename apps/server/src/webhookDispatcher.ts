import { createHmac } from "node:crypto";

import { webhookDeliveries, webhookEndpoints } from "@cube/db";
import { and, eq, lte } from "drizzle-orm";

import { db } from "./services";

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 20;
const TIMEOUT_MS = 10_000;

/**
 * Sign a delivery the way tenants verify it:
 * `t=<unix seconds>,v1=<hmac-sha256 of "t.body">`.
 */
function sign(body: string, secret: string): string {
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = createHmac("sha256", secret)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	return `t=${timestamp},v1=${signature}`;
}

async function recordFailure(
	id: string,
	attempts: number,
	responseStatus: number | null,
	lastError: string,
	previousAttempts: number,
): Promise<void> {
	if (attempts >= MAX_ATTEMPTS) {
		await db
			.update(webhookDeliveries)
			.set({ status: "failed", attempts, responseStatus, lastError })
			.where(eq(webhookDeliveries.id, id));
		return;
	}
	const delay = Math.min(2 ** previousAttempts * 5_000, 3_600_000);
	await db
		.update(webhookDeliveries)
		.set({
			attempts,
			responseStatus,
			lastError,
			nextAttemptAt: new Date(Date.now() + delay),
		})
		.where(eq(webhookDeliveries.id, id));
}

/** Deliver one batch of due webhook deliveries. Returns how many succeeded. */
export async function dispatchDueWebhooks(): Promise<number> {
	const due = await db
		.select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
		.from(webhookDeliveries)
		.innerJoin(
			webhookEndpoints,
			eq(webhookEndpoints.id, webhookDeliveries.endpointId),
		)
		.where(
			and(
				eq(webhookDeliveries.status, "pending"),
				lte(webhookDeliveries.nextAttemptAt, new Date()),
				eq(webhookEndpoints.active, true),
			),
		)
		.limit(BATCH_SIZE);

	let succeeded = 0;
	for (const { delivery, endpoint } of due) {
		const body = JSON.stringify(delivery.payload);
		const attempts = delivery.attempts + 1;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const response = await fetch(endpoint.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"cube-signature": sign(body, endpoint.secret),
					"cube-event": delivery.event,
					"cube-delivery": delivery.id,
					"user-agent": "Cube-Webhooks/1.0",
				},
				body,
				signal: controller.signal,
			});
			clearTimeout(timer);
			if (response.ok) {
				await db
					.update(webhookDeliveries)
					.set({
						status: "success",
						attempts,
						responseStatus: response.status,
						deliveredAt: new Date(),
						lastError: null,
					})
					.where(eq(webhookDeliveries.id, delivery.id));
				succeeded += 1;
			} else {
				await recordFailure(
					delivery.id,
					attempts,
					response.status,
					`HTTP ${response.status}`,
					delivery.attempts,
				);
			}
		} catch (error) {
			clearTimeout(timer);
			await recordFailure(
				delivery.id,
				attempts,
				null,
				error instanceof Error ? error.message : String(error),
				delivery.attempts,
			);
		}
	}
	return succeeded;
}

/** Poll for due deliveries on an interval. */
export function startWebhookDispatcher(intervalMs = 5_000): void {
	const tick = (): void => {
		void dispatchDueWebhooks().catch((error) => {
			console.error("[webhooks] dispatch failed", error);
		});
	};
	tick();
	setInterval(tick, intervalMs).unref();
}
