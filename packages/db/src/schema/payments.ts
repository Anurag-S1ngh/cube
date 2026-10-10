import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { customers, invoices } from "./billing";

export const declineCodes = [
	"insufficient_funds",
	"expired_card",
	"authentication_required",
	"do_not_honor",
	"processing_error",
	"invalid_account",
	"fraudulent",
	"stolen_card",
	"lost_card",
	"card_not_supported",
	"generic_decline",
] as const;
export type DeclineCode = (typeof declineCodes)[number];

/**
 * A failed charge attempt reported by the payment provider. This is the entry
 * point of the agent: a webhook creates one row per failed attempt.
 */
export const failedPaymentEvents = pgTable(
	"failed_payment_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		provider: text("provider").notNull().default("mock"),
		// Idempotency key: the provider's event id. Re-delivery is ignored.
		providerEventId: text("provider_event_id").notNull().unique(),
		projectId: uuid("project_id").notNull(),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "cascade" }),
		invoiceId: uuid("invoice_id").references(() => invoices.id, {
			onDelete: "set null",
		}),
		invoiceNumber: text("invoice_number"),
		amountCents: integer("amount_cents").notNull(),
		currency: text("currency").notNull().default("usd"),
		declineCode: text("decline_code").$type<DeclineCode>().notNull(),
		attemptNumber: integer("attempt_number").notNull().default(1),
		raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
		receivedAt: timestamp("received_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => [
		index("fpe_customer_idx").on(table.customerId),
		index("fpe_processed_idx").on(table.processedAt),
	],
);

export type FailedPaymentEvent = typeof failedPaymentEvents.$inferSelect;
export type NewFailedPaymentEvent = typeof failedPaymentEvents.$inferInsert;
