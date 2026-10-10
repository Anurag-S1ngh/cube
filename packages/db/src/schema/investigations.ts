import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { customers } from "./billing";
import { failedPaymentEvents } from "./payments";

export const investigationStatuses = [
	"received",
	"investigating",
	"classified",
	"recommended",
	"actioned",
	"escalated",
	"resolved",
	"failed",
] as const;
export type InvestigationStatus = (typeof investigationStatuses)[number];

export const investigations = pgTable(
	"investigations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// One investigation per failed-payment event.
		eventId: uuid("event_id")
			.notNull()
			.unique()
			.references(() => failedPaymentEvents.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "cascade" }),
		status: text("status")
			.$type<InvestigationStatus>()
			.notNull()
			.default("received"),
		// Financial context returned by cfo.ai (deterministic model).
		outstandingBalanceCents: integer("outstanding_balance_cents"),
		revenueAtRiskCents: integer("revenue_at_risk_cents"),
		cfoScenarioRef: text("cfo_scenario_ref"),
		cfoEvidence: jsonb("cfo_evidence").$type<Record<string, unknown>>(),
		// Observability + provenance links (the systems of record).
		neatlogsTraceId: text("neatlogs_trace_id"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		closedAt: timestamp("closed_at", { withTimezone: true }),
	},
	(table) => [
		index("investigations_status_idx").on(table.status),
		index("investigations_customer_idx").on(table.customerId),
	],
);

export const causes = pgTable(
	"causes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigationId: uuid("investigation_id")
			.notNull()
			.references(() => investigations.id, { onDelete: "cascade" }),
		code: text("code").notNull(),
		label: text("label").notNull(),
		severity: text("severity").$type<"soft" | "hard" | "risk">().notNull(),
		// 0-100 integer confidence.
		confidence: integer("confidence").notNull().default(0),
		evidence: jsonb("evidence")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("causes_investigation_idx").on(table.investigationId)],
);

export type RecommendedAction = {
	type:
		| "retry_schedule"
		| "email_reminder"
		| "card_update_link"
		| "sca_auth_link"
		| "alt_payment_method"
		| "pause_subscription"
		| "risk_escalation";
	description: string;
	schedule?: string;
	templateId?: string;
};

export const recommendations = pgTable(
	"recommendations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigationId: uuid("investigation_id")
			.notNull()
			.references(() => investigations.id, { onDelete: "cascade" }),
		summary: text("summary").notNull(),
		rationale: text("rationale").notNull(),
		actions: jsonb("actions")
			.$type<RecommendedAction[]>()
			.notNull()
			.default([]),
		cashImpactCents: integer("cash_impact_cents").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("recommendations_investigation_idx").on(table.investigationId),
	],
);

export const mitigationScenarios = pgTable(
	"mitigation_scenarios",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigationId: uuid("investigation_id")
			.notNull()
			.references(() => investigations.id, { onDelete: "cascade" }),
		// Deterministic scenario computed by the cfo.ai model.
		cfoRef: text("cfo_ref").notNull(),
		kind: text("kind").notNull(),
		projectedInflowCents: integer("projected_inflow_cents")
			.notNull()
			.default(0),
		assumptions: jsonb("assumptions")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("mitigation_scenarios_investigation_idx").on(table.investigationId),
	],
);

export type Investigation = typeof investigations.$inferSelect;
export type NewInvestigation = typeof investigations.$inferInsert;
export type Cause = typeof causes.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type MitigationScenario = typeof mitigationScenarios.$inferSelect;
