import {
	apiKeys,
	customers,
	invoices,
	metrics,
	plans,
	prices,
	projects,
	subscriptions,
	users,
} from "@cube/db";
import { eq } from "drizzle-orm";

import { generateApiKey } from "../auth/apiKeys";
import { hashPassword } from "../auth/password";
import { db } from "../services";
import { generateWebhookSecret } from "../webhookSecret";

const DEMO_EMAIL = "demo@cube.test";
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password";

type DemoCustomer = {
	externalId: string;
	name: string;
	email: string;
	amountDollars: number;
};

const demoCustomers: DemoCustomer[] = [
	{
		externalId: "cus_acme",
		name: "Acme Corp",
		email: "billing@acme.test",
		amountDollars: 2999,
	},
	{
		externalId: "cus_globex",
		name: "Globex",
		email: "ap@globex.test",
		amountDollars: 1249,
	},
	{
		externalId: "cus_initech",
		name: "Initech",
		email: "finance@initech.test",
		amountDollars: 649,
	},
	{
		externalId: "cus_umbrella",
		name: "Umbrella",
		email: "payments@umbrella.test",
		amountDollars: 349,
	},
	{
		externalId: "cus_soylent",
		name: "Soylent",
		email: "billing@soylent.test",
		amountDollars: 149,
	},
	{
		externalId: "cus_hooli",
		name: "Hooli",
		email: "ap@hooli.test",
		amountDollars: 49,
	},
];

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function seedDemo(): Promise<{
	projectId: string;
	customerCount: number;
	apiKey?: string;
	webhookSecret: string;
}> {
	// 1. Owner user (with a login password)
	const passwordHash = await hashPassword(DEMO_PASSWORD);
	await db
		.insert(users)
		.values({
			username: DEMO_USERNAME,
			email: DEMO_EMAIL,
			passwordHash,
		})
		.onConflictDoUpdate({
			target: users.username,
			set: { passwordHash, email: DEMO_EMAIL },
		});
	const [owner] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, DEMO_USERNAME))
		.limit(1);
	if (!owner) throw new Error("failed to seed owner user");

	// 2. Project
	await db
		.insert(projects)
		.values({
			name: "Demo Billing",
			description: "Demo project for the payment-failure resolution agent",
			slug: "demo-billing",
			userId: owner.id,
			defaultCurrency: "USD",
		})
		.onConflictDoNothing();
	const [project] = await db
		.select({ id: projects.id, webhookSecret: projects.webhookSecret })
		.from(projects)
		.where(eq(projects.slug, "demo-billing"))
		.limit(1);
	if (!project) throw new Error("failed to seed project");

	// 2b. Webhook signing secret (created once; drives per-project HMAC verify)
	let webhookSecret = project.webhookSecret;
	if (!webhookSecret) {
		webhookSecret = generateWebhookSecret();
		await db
			.update(projects)
			.set({ webhookSecret })
			.where(eq(projects.id, project.id));
	}

	// 3. Metric + plan + price
	await db
		.insert(metrics)
		.values({
			projectId: project.id,
			name: "api_calls",
			description: "Billable API calls",
			unit: "call",
			aggregation: "sum",
		})
		.onConflictDoNothing();
	const [metric] = await db
		.select({ id: metrics.id })
		.from(metrics)
		.where(eq(metrics.name, "api_calls"))
		.limit(1);

	await db
		.insert(plans)
		.values({
			projectId: project.id,
			name: "Growth",
			description: "Growth plan",
			externalPlanId: "plan_demo_growth",
		})
		.onConflictDoNothing();
	const [plan] = await db
		.select({ id: plans.id })
		.from(plans)
		.where(eq(plans.externalPlanId, "plan_demo_growth"))
		.limit(1);
	if (!plan || !metric) throw new Error("failed to seed plan/metric");

	await db
		.insert(prices)
		.values({
			projectId: project.id,
			planId: plan.id,
			metricId: metric.id,
			unitAmount: "0.020000",
			currency: "USD",
			modelType: "unit",
			cadence: "monthly",
			externalPriceId: "price_demo_unit",
		})
		.onConflictDoNothing();

	// 4. Customers, subscriptions and overdue invoices
	let customerCount = 0;
	for (const [index, entry] of demoCustomers.entries()) {
		await db
			.insert(customers)
			.values({
				projectId: project.id,
				externalId: entry.externalId,
				name: entry.name,
				email: entry.email,
			})
			.onConflictDoNothing();
		const [customer] = await db
			.select({ id: customers.id })
			.from(customers)
			.where(eq(customers.externalId, entry.externalId))
			.limit(1);
		if (!customer) continue;
		customerCount += 1;

		await db
			.insert(subscriptions)
			.values({
				projectId: project.id,
				planId: plan.id,
				customerId: customer.id,
				status: "active",
				externalSubscriptionId: `sub_${entry.externalId}`,
				cadence: "monthly",
				startDate: daysAgo(90),
				currentPeriodStart: daysAgo(7),
				currentPeriodEnd: daysAgo(-23),
			})
			.onConflictDoNothing();

		const periodStart = daysAgo(30 - index);
		const periodEnd = daysAgo(0 - index);
		await db
			.insert(invoices)
			.values({
				projectId: project.id,
				customerId: customer.id,
				status: "pending",
				invoiceNumber: `INV-DEMO-${String(index + 1).padStart(3, "0")}`,
				currency: "USD",
				totalAmount: entry.amountDollars.toFixed(6),
				periodStart,
				periodEnd,
				issuedAt: periodStart,
				dueDate: daysAgo(1 + index),
			})
			.onConflictDoNothing();
	}

	// 5. API key for machine access (created once; printed below)
	const [existingKey] = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(eq(apiKeys.projectId, project.id))
		.limit(1);

	let apiKey: string | undefined;
	if (!existingKey) {
		const generated = generateApiKey();
		await db.insert(apiKeys).values({
			projectId: project.id,
			name: "Demo server key",
			keyPrefix: generated.keyPrefix,
			keyHash: generated.keyHash,
		});
		apiKey = generated.raw;
	}

	return { projectId: project.id, customerCount, apiKey, webhookSecret };
}

if (import.meta.main) {
	const result = await seedDemo();
	console.log(
		`Seeded demo project ${result.projectId} with ${result.customerCount} customers`,
	);
	console.log(`  login:   ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
	console.log(`  webhook: ${result.webhookSecret}`);
	if (result.apiKey) {
		console.log(`  api key: ${result.apiKey}`);
	} else {
		console.log("  api key: (already exists — revoke + re-run to rotate)");
	}
	process.exit(0);
}
