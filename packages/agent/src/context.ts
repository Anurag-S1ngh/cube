import type { Database } from "@cube/db";
import {
	customers,
	failedPaymentEvents,
	investigations,
	invoices,
} from "@cube/db";
import { and, count, eq, lt } from "drizzle-orm";

import type { DeclineCode } from "./types";

export type InvestigationContext = {
	investigationId: string;
	event: {
		id: string;
		amountCents: number;
		currency: string;
		declineCode: DeclineCode;
		attemptNumber: number;
		invoiceNumber: string | null;
		receivedAt: Date;
	};
	customer: {
		id: string;
		name: string | null;
		email: string | null;
		externalId: string;
	};
	invoice: {
		id: string;
		status: string;
		totalAmount: number;
		dueDate: Date;
	} | null;
	priorFailureCount: number;
	overdueDays: number;
	paymentHistory: {
		paid: number;
		unpaid: number;
	};
};

function daysBetween(from: Date, to: Date): number {
	return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

/**
 * Load everything the agent needs to reason about one failed payment:
 * the failed event, the customer, the invoice, the customer's prior failures
 * and their overall payment behaviour.
 */
export async function gatherContext(
	db: Database,
	investigationId: string,
): Promise<InvestigationContext> {
	const [row] = await db
		.select({
			event: failedPaymentEvents,
			customer: customers,
			investigation: investigations,
		})
		.from(investigations)
		.innerJoin(
			failedPaymentEvents,
			eq(failedPaymentEvents.id, investigations.eventId),
		)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.where(eq(investigations.id, investigationId))
		.limit(1);

	if (!row) {
		throw new Error(`investigation ${investigationId} not found`);
	}

	const { event, customer } = row;

	const invoice = event.invoiceId
		? ((
				await db
					.select({
						id: invoices.id,
						status: invoices.status,
						totalAmount: invoices.totalAmount,
						dueDate: invoices.dueDate,
					})
					.from(invoices)
					.where(eq(invoices.id, event.invoiceId))
					.limit(1)
			)[0] ?? null)
		: null;

	const [prior] = await db
		.select({ value: count() })
		.from(failedPaymentEvents)
		.where(
			and(
				eq(failedPaymentEvents.customerId, customer.id),
				lt(failedPaymentEvents.receivedAt, event.receivedAt),
			),
		);

	const [paid] = await db
		.select({ value: count() })
		.from(invoices)
		.where(
			and(eq(invoices.customerId, customer.id), eq(invoices.status, "paid")),
		);

	const [unpaid] = await db
		.select({ value: count() })
		.from(invoices)
		.where(
			and(eq(invoices.customerId, customer.id), eq(invoices.status, "pending")),
		);

	return {
		investigationId,
		event: {
			id: event.id,
			amountCents: event.amountCents,
			currency: event.currency,
			declineCode: event.declineCode,
			attemptNumber: event.attemptNumber,
			invoiceNumber: event.invoiceNumber,
			receivedAt: event.receivedAt,
		},
		customer: {
			id: customer.id,
			name: customer.name,
			email: customer.email,
			externalId: customer.externalId,
		},
		invoice: invoice
			? {
					id: invoice.id,
					status: invoice.status,
					totalAmount: Number(invoice.totalAmount),
					dueDate: invoice.dueDate,
				}
			: null,
		priorFailureCount: Number(prior?.value ?? 0),
		overdueDays: invoice ? daysBetween(invoice.dueDate, new Date()) : 0,
		paymentHistory: {
			paid: Number(paid?.value ?? 0),
			unpaid: Number(unpaid?.value ?? 0),
		},
	};
}
