import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { investigations } from "./investigations";

export const emailStatuses = ["queued", "sent", "blocked", "failed"] as const;
export type EmailStatus = (typeof emailStatuses)[number];

export const emailActions = pgTable(
	"email_actions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigationId: uuid("investigation_id")
			.notNull()
			.references(() => investigations.id, { onDelete: "cascade" }),
		templateId: text("template_id").notNull(),
		to: text("to").notNull(),
		subject: text("subject").notNull(),
		body: text("body").notNull(),
		status: text("status").$type<EmailStatus>().notNull().default("queued"),
		provider: text("provider").notNull().default("mock"),
		providerMessageId: text("provider_message_id"),
		// Reason a guardrail blocked the send, if any.
		blockReason: text("block_reason"),
		sentAt: timestamp("sent_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("email_actions_investigation_idx").on(table.investigationId),
		index("email_actions_to_idx").on(table.to),
	],
);

export const approvalDecisions = ["auto", "approved", "rejected"] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];

export const approvals = pgTable(
	"approvals",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigationId: uuid("investigation_id")
			.notNull()
			.references(() => investigations.id, { onDelete: "cascade" }),
		// "agent" for auto-send, or a human operator id.
		actor: text("actor").notNull().default("agent"),
		decision: text("decision").$type<ApprovalDecision>().notNull(),
		reason: text("reason"),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("approvals_investigation_idx").on(table.investigationId)],
);

export type EmailAction = typeof emailActions.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
