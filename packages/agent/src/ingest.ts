import type { Database, DeclineCode } from "@cube/db";
import {
	customers,
	declineCodes,
	failedPaymentEvents,
	investigations,
} from "@cube/db";
import { and, eq } from "drizzle-orm";

import type { PaymentFailurePayload } from "./types";
import { emitWebhookEvent } from "./webhooks";

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

	await emitWebhookEvent(db, {
		projectId: customer.projectId,
		event: "investigation.created",
		investigationId: investigation.id,
		data: {
			customerId,
			amountCents: payload.data.amountCents,
			currency: payload.data.currency,
			declineCode: payload.data.declineCode,
			invoiceNumber: payload.data.invoiceNumber,
		},
	});

	return {
		eventId: event.id,
		investigationId: investigation.id,
		duplicate: false,
	};
}

/** Normalized failed-payment input for a tenant integrating via the API/SDK. */
export type ExternalFailureInput = {
	customerExternalId: string;
	customer?: { name?: string | null; email?: string | null };
	invoiceNumber?: string | null;
	amountCents: number;
	currency?: string;
	declineCode: string;
	attemptNumber?: number;
	provider?: string;
	occurredAt?: string;
	paymentMethod?: {
		brand?: string;
		last4?: string;
		expMonth?: number;
		expYear?: number;
	};
	/** When true (default) an unknown customer is created under the project. */
	createCustomerIfMissing?: boolean;
};

/**
 * Ingest a failed payment from a tenant's own backend. Identifies the customer
 * by their external id (scoped to the project), optionally creating them, then
 * reuses the standard webhook ingest path so behaviour stays identical.
 * Idempotent on `idempotencyKey`.
 */
export async function ingestExternalFailedPayment(
	db: Database,
	projectId: string,
	idempotencyKey: string,
	input: ExternalFailureInput,
): Promise<IngestResult> {
	if (!idempotencyKey || idempotencyKey.length > 200) {
		throw new IngestError("a valid idempotency key is required");
	}
	if (!input.customerExternalId) {
		throw new IngestError("customerExternalId is required");
	}
	if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
		throw new IngestError("amountCents must be a positive integer");
	}
	if (!declineCodes.includes(input.declineCode as DeclineCode)) {
		throw new IngestError(`unknown declineCode: ${input.declineCode}`);
	}

	let [customer] = await db
		.select({
			id: customers.id,
			name: customers.name,
			email: customers.email,
		})
		.from(customers)
		.where(
			and(
				eq(customers.projectId, projectId),
				eq(customers.externalId, input.customerExternalId),
			),
		)
		.limit(1);

	if (!customer) {
		if (input.createCustomerIfMissing === false) {
			throw new IngestError(
				`unknown customer for this project: ${input.customerExternalId}`,
			);
		}
		const [created] = await db
			.insert(customers)
			.values({
				projectId,
				externalId: input.customerExternalId,
				name: input.customer?.name ?? null,
				email: input.customer?.email ?? null,
			})
			.onConflictDoNothing()
			.returning({
				id: customers.id,
				name: customers.name,
				email: customers.email,
			});
		if (created) {
			customer = created;
		} else {
			[customer] = await db
				.select({
					id: customers.id,
					name: customers.name,
					email: customers.email,
				})
				.from(customers)
				.where(
					and(
						eq(customers.projectId, projectId),
						eq(customers.externalId, input.customerExternalId),
					),
				)
				.limit(1);
		}
	}
	if (!customer) {
		throw new IngestError("failed to resolve customer");
	}

	const method = input.paymentMethod ?? {};
	const payload: PaymentFailurePayload = {
		id: `sdk:${projectId}:${idempotencyKey}`,
		provider: input.provider ?? "sdk",
		type: "invoice.payment_failed",
		createdAt: input.occurredAt ?? new Date().toISOString(),
		data: {
			projectId,
			customerExternalId: input.customerExternalId,
			customerId: customer.id,
			invoiceId: null,
			invoiceNumber: input.invoiceNumber ?? null,
			amountCents: input.amountCents,
			currency: (input.currency ?? "usd").toLowerCase(),
			declineCode: input.declineCode as DeclineCode,
			attemptNumber: input.attemptNumber ?? 1,
			paymentMethod: {
				brand: method.brand ?? "unknown",
				last4: method.last4 ?? "0000",
				expMonth: method.expMonth ?? 1,
				expYear: method.expYear ?? new Date().getFullYear() + 3,
			},
			customer: {
				name: input.customer?.name ?? customer.name,
				email: input.customer?.email ?? customer.email,
			},
		},
	};

	return ingestFailedPayment(db, payload, projectId);
}
