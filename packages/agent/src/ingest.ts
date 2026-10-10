import type { Database, DeclineCode } from "@cube/db";
import {
	customers,
	declineCodes,
	failedPaymentEvents,
	investigations,
} from "@cube/db";
import { eq } from "drizzle-orm";

import type { PaymentFailurePayload } from "./types";

export type IngestResult = {
	eventId: string;
	investigationId: string;
	duplicate: boolean;
};

/** Thrown for a payload the provider should not have sent (maps to HTTP 400). */
export class IngestError extends Error {}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turn a provider webhook payload into an event + investigation.
 * Idempotent on the provider event id, so webhook re-delivery is safe.
 */
export async function ingestFailedPayment(
	db: Database,
	payload: PaymentFailurePayload,
	expectedProjectId?: string,
): Promise<IngestResult> {
	const { customerId, declineCode } = payload.data;

	if (!customerId || !uuidPattern.test(customerId)) {
		throw new IngestError("payload has an invalid customerId");
	}
	if (!declineCodes.includes(declineCode as DeclineCode)) {
		throw new IngestError(`unknown declineCode: ${String(declineCode)}`);
	}

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

	// The customer is authoritative for the project; derive it rather than
	// trusting an optional (possibly absent) value on the payload.
	const [customer] = await db
		.select({ projectId: customers.projectId })
		.from(customers)
		.where(eq(customers.id, customerId))
		.limit(1);
	if (!customer) {
		throw new IngestError(`unknown customer: ${customerId}`);
	}
	if (expectedProjectId && customer.projectId !== expectedProjectId) {
		throw new IngestError("customer does not belong to this project");
	}

	const [event] = await db
		.insert(failedPaymentEvents)
		.values({
			provider: payload.provider,
			providerEventId: payload.id,
			projectId: customer.projectId,
			customerId,
			invoiceId: payload.data.invoiceId,
			invoiceNumber: payload.data.invoiceNumber,
			amountCents: payload.data.amountCents,
			currency: payload.data.currency,
			declineCode,
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
			customerId,
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
