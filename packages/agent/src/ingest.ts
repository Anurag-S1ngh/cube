import type { Database } from "@cube/db";
import { failedPaymentEvents, investigations } from "@cube/db";
import { eq } from "drizzle-orm";

import type { PaymentFailurePayload } from "./types";

export type IngestResult = {
	eventId: string;
	investigationId: string;
	duplicate: boolean;
};

/**
 * Turn a provider webhook payload into an event + investigation.
 * Idempotent on the provider event id, so webhook re-delivery is safe.
 */
export async function ingestFailedPayment(
	db: Database,
	payload: PaymentFailurePayload,
): Promise<IngestResult> {
	const [existing] = await db
		.select({
			eventId: failedPaymentEvents.id,
			investigationId: investigations.id,
		})
		.from(failedPaymentEvents)
		.leftJoin(
			investigations,
			eq(investigations.eventId, failedPaymentEvents.id),
		)
		.where(eq(failedPaymentEvents.providerEventId, payload.id))
		.limit(1);

	if (existing?.investigationId) {
		return {
			eventId: existing.eventId,
			investigationId: existing.investigationId,
			duplicate: true,
		};
	}

	const [event] = await db
		.insert(failedPaymentEvents)
		.values({
			provider: payload.provider,
			providerEventId: payload.id,
			projectId: payload.data.projectId ?? "",
			customerId: payload.data.customerId as string,
			invoiceId: payload.data.invoiceId,
			invoiceNumber: payload.data.invoiceNumber,
			amountCents: payload.data.amountCents,
			currency: payload.data.currency,
			declineCode: payload.data.declineCode,
			attemptNumber: payload.data.attemptNumber,
			raw: payload as unknown as Record<string, unknown>,
		})
		.returning({ id: failedPaymentEvents.id });

	if (!event) {
		throw new Error("Failed to insert failed payment event");
	}

	const [investigation] = await db
		.insert(investigations)
		.values({
			eventId: event.id,
			customerId: payload.data.customerId as string,
			status: "received",
		})
		.returning({ id: investigations.id });

	if (!investigation) {
		throw new Error("Failed to insert investigation");
	}

	return {
		eventId: event.id,
		investigationId: investigation.id,
		duplicate: false,
	};
}
