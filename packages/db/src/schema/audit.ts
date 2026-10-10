import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { investigations } from "./investigations";

export const agentRuns = pgTable(
	"agent_runs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigationId: uuid("investigation_id")
			.notNull()
			.references(() => investigations.id, { onDelete: "cascade" }),
		pipelineState: text("pipeline_state").notNull(),
		model: text("model"),
		tokensIn: integer("tokens_in").notNull().default(0),
		tokensOut: integer("tokens_out").notNull().default(0),
		costCents: integer("cost_cents").notNull().default(0),
		latencyMs: integer("latency_ms").notNull().default(0),
		neatlogsTraceId: text("neatlogs_trace_id"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("agent_runs_investigation_idx").on(table.investigationId)],
);

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		entity: text("entity").notNull(),
		entityId: uuid("entity_id"),
		action: text("action").notNull(),
		actor: text("actor").notNull().default("agent"),
		payload: jsonb("payload")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("audit_log_entity_idx").on(table.entity, table.entityId)],
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
