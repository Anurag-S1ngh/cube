import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./billing";
import { investigations } from "./investigations";

// ---------------------------------------------------------------------------
// Outbound webhooks: tenants register endpoints and Cube delivers signed
// lifecycle events (investigation.created, .actioned, .resolved, …).
// ---------------------------------------------------------------------------
export const webhookEndpoints = pgTable(
	"webhook_endpoints",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		secret: text("secret").notNull(),
		description: text("description"),
		// Empty array means "all events".
		events: jsonb("events").$type<string[]>().notNull().default([]),
		active: boolean("active").notNull().default(true),
		disabledAt: timestamp("disabled_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("webhook_endpoints_project_idx").on(table.projectId)],
);

export const webhookDeliveryStatuses = [
	"pending",
	"success",
	"failed",
] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number];

export const webhookDeliveries = pgTable(
	"webhook_deliveries",
	{
		id: uuid().defaultRandom().primaryKey(),
		endpointId: uuid("endpoint_id")
			.notNull()
			.references(() => webhookEndpoints.id, { onDelete: "cascade" }),
		investigationId: uuid("investigation_id").references(
			() => investigations.id,
			{ onDelete: "set null" },
		),
		event: text("event").notNull(),
		payload: jsonb("payload")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		status: text("status")
			.$type<WebhookDeliveryStatus>()
			.notNull()
			.default("pending"),
		attempts: integer("attempts").notNull().default(0),
		responseStatus: integer("response_status"),
		lastError: text("last_error"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("webhook_deliveries_pending_idx").on(
			table.status,
			table.nextAttemptAt,
		),
		index("webhook_deliveries_endpoint_idx").on(table.endpointId),
	],
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
