import { sql } from "drizzle-orm";
import {
	foreignKey,
	index,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Cube usage-based billing platform (existing schema, introspected from the
// live database). The payment-failure agent reads from these tables and adds
// its own tables alongside them.
// ---------------------------------------------------------------------------

export const cadenceEnum = pgEnum("cadence_enum", ["monthly", "yearly"]);
export const currencyEnum = pgEnum("currency_enum", ["USD", "JPY", "INR"]);
export const granularityEnum = pgEnum("granularity_enum", [
	"hour",
	"day",
	"week",
	"month",
]);
export const invoiceStatusEnum = pgEnum("invoice_status_enum", [
	"draft",
	"pending",
	"paid",
]);
export const lineItemTypeEnum = pgEnum("line_item_type_enum", [
	"fixed",
	"usage",
]);
export const aggregationEnum = pgEnum("aggregation_enum", [
	"sum",
	"max",
	"count",
]);
export const priceModelTypeEnum = pgEnum("price_model_type_enum", [
	"unit",
	"tiered",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status_enum", [
	"active",
	"upcoming",
	"canceled",
]);

export const users = pgTable(
	"users",
	{
		id: uuid().defaultRandom().primaryKey(),
		username: text().notNull(),
		email: text().notNull(),
		// Argon2id hash (via Bun.password). Nullable only to allow rolling the
		// column onto pre-existing rows; a user without a hash cannot log in.
		passwordHash: text("password_hash"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		unique("users_email_key").on(table.email),
		unique("users_username_key").on(table.username),
	],
);

export const projects = pgTable(
	"projects",
	{
		id: uuid().defaultRandom().primaryKey(),
		name: text().notNull(),
		description: text(),
		slug: text().notNull(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		defaultCurrency: currencyEnum("default_currency").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [unique("projects_slug_key").on(table.slug)],
);

export const customers = pgTable(
	"customers",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		externalId: text("external_id").notNull(),
		name: text(),
		email: text(),
		phone: text(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("customers_project_email_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.email.asc().nullsLast(),
		),
		unique("customers_project_id_external_id_unique").on(
			table.projectId,
			table.externalId,
		),
	],
);

export const metrics = pgTable(
	"metrics",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		name: text().notNull(),
		description: text(),
		unit: text().notNull(),
		aggregation: aggregationEnum().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		unique("metrics_project_id_name_unique").on(table.projectId, table.name),
	],
);

export const events = pgTable(
	"events",
	{
		id: uuid().defaultRandom().primaryKey(),
		metricId: uuid("metric_id")
			.notNull()
			.references(() => metrics.id),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id),
		idempotencyKey: text("idempotency_key").notNull(),
		quantity: numeric({ precision: 20, scale: 6 }).notNull(),
		timestamp: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("events_project_customer_ts_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.customerId.asc().nullsLast(),
			table.timestamp.asc().nullsLast(),
		),
		index("events_project_metric_ts_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.metricId.asc().nullsLast(),
			table.timestamp.asc().nullsLast(),
		),
		unique("events_project_id_idempotency_key_unique").on(
			table.projectId,
			table.idempotencyKey,
		),
	],
);

export const plans = pgTable(
	"plans",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		name: text().notNull(),
		description: text(),
		externalPlanId: text("external_plan_id").notNull(),
		parentId: uuid("parent_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "plans_parent_id_plans_id_fkey",
		}),
		unique("plans_project_id_external_plan_id_unique").on(
			table.projectId,
			table.externalPlanId,
		),
	],
);

export const prices = pgTable(
	"prices",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		planId: uuid("plan_id")
			.notNull()
			.references(() => plans.id),
		metricId: uuid("metric_id")
			.notNull()
			.references(() => metrics.id),
		unitAmount: numeric("unit_amount", { precision: 20, scale: 6 }),
		currency: currencyEnum().notNull(),
		modelType: priceModelTypeEnum("model_type").notNull(),
		cadence: cadenceEnum().notNull(),
		externalPriceId: text("external_price_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("prices_plan_idx").using("btree", table.planId.asc().nullsLast()),
		index("prices_project_metric_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.metricId.asc().nullsLast(),
		),
		unique("prices_project_id_external_price_id_unique").on(
			table.projectId,
			table.externalPriceId,
		),
	],
);

export const priceTiers = pgTable(
	"price_tiers",
	{
		id: uuid().defaultRandom().primaryKey(),
		priceId: uuid("price_id")
			.notNull()
			.references(() => prices.id),
		firstUnit: numeric("first_unit", { precision: 20, scale: 6 }).notNull(),
		lastUnit: numeric("last_unit", { precision: 20, scale: 6 }),
		unitAmount: numeric("unit_amount", { precision: 20, scale: 6 }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("price_tiers_price_idx").using(
			"btree",
			table.priceId.asc().nullsLast(),
		),
		unique("price_tiers_price_id_first_unit_unique").on(
			table.priceId,
			table.firstUnit,
		),
	],
);

export const subscriptions = pgTable(
	"subscriptions",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		planId: uuid("plan_id")
			.notNull()
			.references(() => plans.id),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id),
		status: subscriptionStatusEnum().notNull(),
		externalSubscriptionId: text("external_subscription_id").notNull(),
		cadence: cadenceEnum().notNull(),
		startDate: timestamp("start_date", { withTimezone: true }).notNull(),
		endDate: timestamp("end_date", { withTimezone: true }),
		currentPeriodStart: timestamp("current_period_start", {
			withTimezone: true,
		}),
		currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
		canceledAt: timestamp("canceled_at", { withTimezone: true }),
	},
	(table) => [
		index("subscriptions_project_customer_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.customerId.asc().nullsLast(),
		),
		index("subscriptions_project_status_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.status.asc().nullsLast(),
		),
		unique("subscriptions_project_id_external_subscription_id_unique").on(
			table.projectId,
			table.externalSubscriptionId,
		),
	],
);

export const subscriptionPriceIntervals = pgTable(
	"subscription_price_intervals",
	{
		id: uuid().defaultRandom().primaryKey(),
		subscriptionId: uuid("subscription_id")
			.notNull()
			.references(() => subscriptions.id),
		priceId: uuid("price_id")
			.notNull()
			.references(() => prices.id),
		startDate: timestamp("start_date", { withTimezone: true }).notNull(),
		endDate: timestamp("end_date", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("subscription_price_intervals_sub_idx").using(
			"btree",
			table.subscriptionId.asc().nullsLast(),
		),
	],
);

export const invoices = pgTable(
	"invoices",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id),
		status: invoiceStatusEnum().notNull(),
		invoiceNumber: text("invoice_number").notNull(),
		currency: currencyEnum().notNull(),
		totalAmount: numeric("total_amount", { precision: 20, scale: 6 }).notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
		issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
		paidAt: timestamp("paid_at", { withTimezone: true }),
		dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("invoices_project_customer_status_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.customerId.asc().nullsLast(),
			table.status.asc().nullsLast(),
		),
		unique("invoices_project_customer_period_uniq").on(
			table.projectId,
			table.customerId,
			table.periodStart,
			table.periodEnd,
		),
		unique("invoices_project_id_invoice_number_unique").on(
			table.projectId,
			table.invoiceNumber,
		),
	],
);

export const invoiceItems = pgTable(
	"invoice_items",
	{
		id: uuid().defaultRandom().primaryKey(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoices.id),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id),
		priceId: uuid("price_id").references(() => prices.id),
		metricId: uuid("metric_id").references(() => metrics.id),
		type: lineItemTypeEnum().notNull(),
		totalQuantity: numeric("total_quantity", {
			precision: 20,
			scale: 6,
		}).notNull(),
		unitAmount: numeric("unit_amount", { precision: 20, scale: 6 }).notNull(),
		amount: numeric({ precision: 20, scale: 6 }).notNull(),
		currency: currencyEnum().notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }),
		periodEnd: timestamp("period_end", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
		subscriptionId: uuid("subscription_id")
			.notNull()
			.references(() => subscriptions.id),
	},
	(table) => [
		index("invoice_items_invoice_idx").using(
			"btree",
			table.invoiceId.asc().nullsLast(),
		),
		index("invoice_items_project_subscription_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.subscriptionId.asc().nullsLast(),
		),
	],
);

export const usageAggregates = pgTable(
	"usage_aggregates",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		metricId: uuid("metric_id")
			.notNull()
			.references(() => metrics.id),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id),
		value: numeric({ precision: 20, scale: 6 }).notNull(),
		granularity: granularityEnum().notNull(),
		aggregation: aggregationEnum().notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("usage_aggregates_project_customer_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
			table.customerId.asc().nullsLast(),
			table.metricId.asc().nullsLast(),
		),
		unique(
			"usage_aggregates_project_id_customer_id_metric_id_granularity_p",
		).on(
			table.projectId,
			table.customerId,
			table.metricId,
			table.granularity,
			table.periodStart,
		),
	],
);

export const usageProcessedEvents = pgTable(
	"usage_processed_events",
	{
		id: uuid().defaultRandom().primaryKey(),
		eventId: uuid("event_id")
			.notNull()
			.references(() => events.id),
		processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
	},
	(table) => [unique("usage_processed_events_event_id_key").on(table.eventId)],
);

export const apiKeys = pgTable(
	"api_keys",
	{
		id: uuid().defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id),
		name: text().notNull(),
		keyPrefix: text("key_prefix").notNull(),
		keyHash: text("key_hash").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`now()`)
			.notNull(),
	},
	(table) => [
		index("api_keys_project_idx").using(
			"btree",
			table.projectId.asc().nullsLast(),
		),
		unique("api_keys_key_hash_key").on(table.keyHash),
	],
);

export type Customer = typeof customers.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
