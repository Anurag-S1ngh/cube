import {
	demoDeclineSequence,
	generateFailurePayload,
	ingestFailedPayment,
} from "@cube/agent";
import { customers, invoices } from "@cube/db";
import { eq } from "drizzle-orm";

import { db } from "../services";

/**
 * Simulate a batch of failed charges against the demo project's overdue
 * invoices. Each failure is emitted as a provider webhook payload and ingested
 * through the same path as a real webhook.
 */
export async function simulateFailures(limit = 8) {
	const rows = await db
		.select({
			projectId: invoices.projectId,
			customerId: invoices.customerId,
			customerExternalId: customers.externalId,
			customerName: customers.name,
			customerEmail: customers.email,
			invoiceId: invoices.id,
			invoiceNumber: invoices.invoiceNumber,
			totalAmount: invoices.totalAmount,
			currency: invoices.currency,
		})
		.from(invoices)
		.innerJoin(customers, eq(customers.id, invoices.customerId))
		.where(eq(invoices.status, "pending"))
		.limit(limit);

	const results = [];
	for (const [index, row] of rows.entries()) {
		const payload = generateFailurePayload({
			projectId: row.projectId,
			customerId: row.customerId,
			customerExternalId: row.customerExternalId,
			customerName: row.customerName,
			customerEmail: row.customerEmail,
			invoiceId: row.invoiceId,
			invoiceNumber: row.invoiceNumber,
			amountCents: Math.round(Number(row.totalAmount) * 100),
			currency: row.currency,
			declineCode:
				demoDeclineSequence[index % demoDeclineSequence.length] ??
				"generic_decline",
			attemptNumber: 1,
		});

		const result = await ingestFailedPayment(db, payload);
		results.push({ ...result, payload });
	}

	return results;
}
