import { desc, eq } from "drizzle-orm";

import { getAccessToken, McpClient } from "@cube/agent";
import {
	causes,
	customers,
	failedPaymentEvents,
	investigations,
	mitigationScenarios,
} from "@cube/db";

import { agentConfig } from "../config";
import { db } from "../services";

const oauth = agentConfig.cfo.oauth;
if (!oauth) {
	console.error("cfo.ai OAuth is not configured");
	process.exit(1);
}

const token = await getAccessToken({
	mcpUrl: agentConfig.cfo.mcpUrl,
	credentialsPath: oauth.credentialsPath,
	redirectPort: oauth.redirectPort,
	scope: oauth.scope,
});
if (!token) {
	console.error("No cfo.ai credentials — run `bun run cfo:login` first.");
	process.exit(1);
}

const client = new McpClient({ url: agentConfig.cfo.mcpUrl, token });

const orgResult = (await client.callTool("list_orgs", {})) as {
	orgs?: { org_id?: string; name?: string }[];
};
const orgId = agentConfig.cfo.orgId ?? orgResult.orgs?.[0]?.org_id;
if (!orgId) {
	console.error("No cfo.ai workspace found.");
	process.exit(1);
}

const rows = await db
	.select({
		customer: customers.name,
		email: customers.email,
		cause: causes.code,
		amountCents: failedPaymentEvents.amountCents,
		currency: failedPaymentEvents.currency,
		scenarioRef: mitigationScenarios.cfoRef,
	})
	.from(investigations)
	.innerJoin(customers, eq(customers.id, investigations.customerId))
	.innerJoin(
		failedPaymentEvents,
		eq(failedPaymentEvents.id, investigations.eventId),
	)
	.leftJoin(causes, eq(causes.investigationId, investigations.id))
	.leftJoin(
		mitigationScenarios,
		eq(mitigationScenarios.investigationId, investigations.id),
	)
	.orderBy(desc(investigations.createdAt))
	.limit(15);

function money(cents: number, currency: string): string {
	return `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

const rowsText = rows
	.map(
		(r) =>
			`- **${r.customer ?? "Unknown"}** — ${r.cause ?? "—"} — ${money(
				r.amountCents,
				r.currency,
			)} — ${r.scenarioRef ?? "—"}`,
	)
	.join("\n");

const narrative = [
	"# Payment Recovery",
	"The Cube payment-failure agent investigates failed charges, and records a recovery scenario in cfo.ai for each one.",
	`Snapshot of the latest ${rows.length} investigations:`,
	rowsText,
].map((markdown) => ({ markdown }));

// Recreate the page if it exists, otherwise create it.
const existing = (await client.callTool("inspect_pages", {
	list: {},
	org_id: orgId,
})) as { pages?: { name?: string }[] };
const pageExists = (existing.pages ?? []).some((p) => p.name === "Payment Recovery");
if (pageExists) {
	try {
		await client.callTool("edit_pages", {
			org_id: orgId,
			delete: { target: "Payment Recovery" },
		});
	} catch (error) {
		console.warn(
			"could not delete the existing page:",
			error instanceof Error ? error.message : error,
		);
	}
}

const result = await client.callTool("edit_pages", {
	org_id: orgId,
	create: {
		name: "Payment Recovery",
		icon: "receipt",
		icon_color: "blue",
		text: narrative,
	},
});
void result;

const after = (await client.callTool("inspect_pages", {
	list: {},
	org_id: orgId,
})) as { pages?: { display_name?: string; url?: string }[] };
const page = (after.pages ?? []).find((p) => p.display_name === "Payment Recovery");

console.log(`Published ${rows.length} recovery scenarios to cfo.ai`);
console.log(`Page URL: ${page?.url ?? "(unavailable)"}`);
process.exit(0);
