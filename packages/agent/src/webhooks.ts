import type { Database } from "@cube/db";
import { webhookDeliveries, webhookEndpoints } from "@cube/db";
import { and, eq } from "drizzle-orm";

/**
 * Lifecycle events delivered to tenant endpoints. An endpoint subscribed to an
 * empty list receives every event.
 */
export const webhookEventTypes = [
	"investigation.created",
	"investigation.classified",
	"investigation.actioned",
	"investigation.escalated",
	"investigation.resolved",
	"email.queued",
	"email.sent",
	"email.blocked",
	"email.failed",
] as const;

export type WebhookEventType = (typeof webhookEventTypes)[number];

export type EmitInput = {
	projectId: string;
	event: WebhookEventType;
	investigationId?: string | null;
	data?: Record<string, unknown>;
};

/**
 * Fan out an event to every active endpoint on the project that subscribes to
 * it, by queuing a delivery row for the dispatcher. Best-effort: webhook
 * plumbing must never fail an investigation.
 */
export async function emitWebhookEvent(
	db: Database,
	input: EmitInput,
): Promise<number> {
	try {
		const endpoints = await db
			.select()
			.from(webhookEndpoints)
			.where(
				and(
					eq(webhookEndpoints.projectId, input.projectId),
					eq(webhookEndpoints.active, true),
				),
			);
		const matching = endpoints.filter(
			(endpoint) =>
				endpoint.events.length === 0 || endpoint.events.includes(input.event),
		);
		if (matching.length === 0) return 0;

		const payload = {
			event: input.event,
			investigationId: input.investigationId ?? null,
			createdAt: new Date().toISOString(),
			data: input.data ?? {},
		};
		await db.insert(webhookDeliveries).values(
			matching.map((endpoint) => ({
				endpointId: endpoint.id,
				investigationId: input.investigationId ?? null,
				event: input.event,
				payload,
			})),
		);
		return matching.length;
	} catch (error) {
		console.warn("[webhooks] emit failed", error);
		return 0;
	}
}
