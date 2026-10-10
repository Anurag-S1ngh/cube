import type { Database } from "@cube/db";
import { invoices } from "@cube/db";
import { and, eq, sum } from "drizzle-orm";

import type { InvestigationContext } from "../context";
import { McpClient } from "../mcp/client";
import type { AgentConfig } from "../types";

export type FinancialContext = {
	outstandingBalanceCents: number;
	revenueAtRiskCents: number;
	source: "cfo.ai" | "local-ledger";
	evidence: Record<string, unknown>;
};

export type ScenarioResult = {
	ref: string;
	kind: string;
	projectedInflowCents: number;
	assumptions: Record<string, unknown>;
	source: "cfo.ai" | "local-model";
};

let cachedClient: McpClient | null = null;
let cachedKey = "";

function client(config: AgentConfig): McpClient | null {
	if (!config.cfo.token) return null;
	const key = `${config.cfo.mcpUrl}::${config.cfo.orgId ?? ""}`;
	if (!cachedClient || cachedKey !== key) {
		cachedClient = new McpClient({
			url: config.cfo.mcpUrl,
			token: config.cfo.token,
			orgId: config.cfo.orgId,
		});
		cachedKey = key;
	}
	return cachedClient;
}

function pickCents(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.round(value * 100);
	}
	if (typeof value === "string") {
		const parsed = Number(value.replace(/[^0-9.-]/g, ""));
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
	}
	return null;
}

/**
 * Read the customer's financial position from cfo.ai's model. When cfo.ai is
 * not configured (or unreachable) fall back to the ledger in Postgres so the
 * pipeline always has deterministic numbers to work with.
 */
export async function getFinancialContext(
	db: Database,
	config: AgentConfig,
	ctx: InvestigationContext,
): Promise<FinancialContext> {
	const [ledger] = await db
		.select({ total: sum(invoices.totalAmount) })
		.from(invoices)
		.where(
			and(
				eq(invoices.customerId, ctx.customer.id),
				eq(invoices.status, "pending"),
			),
		);

	const outstandingCents = Math.round(Number(ledger?.total ?? 0) * 100);

	const mcp = client(config);
	if (mcp) {
		try {
			const result = await mcp.callTool("inspect_table_blocks", {
				query: `outstanding balance accounts receivable ${ctx.customer.name ?? ctx.customer.externalId}`,
			});
			const record =
				result && typeof result === "object"
					? (result as Record<string, unknown>)
					: {};
			const outstanding =
				pickCents(record.outstanding_balance) ??
				pickCents(record.outstandingBalanceCents) ??
				outstandingCents;
			const atRisk =
				pickCents(record.revenue_at_risk) ??
				pickCents(record.revenueAtRiskCents) ??
				outstanding;
			return {
				outstandingBalanceCents: outstanding,
				revenueAtRiskCents: atRisk,
				source: "cfo.ai",
				evidence: {
					provider: "cfo.ai",
					customer: ctx.customer.externalId,
					raw: record,
				},
			};
		} catch (error) {
			// Fall through to the ledger fallback but keep the reason for audit.
			return {
				outstandingBalanceCents: outstandingCents,
				revenueAtRiskCents: outstandingCents,
				source: "local-ledger",
				evidence: {
					provider: "local-ledger",
					reason: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	return {
		outstandingBalanceCents: outstandingCents,
		revenueAtRiskCents: outstandingCents,
		source: "local-ledger",
		evidence: {
			provider: "local-ledger",
			pendingInvoices: ctx.paymentHistory.unpaid,
			overdueDays: ctx.overdueDays,
		},
	};
}

/**
 * Ask cfo.ai to model the mitigation scenario (deterministic finance math),
 * falling back to a local projection when cfo.ai is unavailable. Every write in
 * cfo.ai is changelogged and reversible.
 */
export async function createMitigationScenario(
	config: AgentConfig,
	input: {
		investigationId: string;
		kind: string;
		amountCents: number;
		customer: string;
	},
): Promise<ScenarioResult> {
	const mcp = client(config);
	if (mcp) {
		try {
			const result = await mcp.callTool("edit_scenarios", {
				scenario: `Recovery: ${input.customer} (${input.kind})`,
				description: `Payment-failure recovery scenario for investigation ${input.investigationId}`,
				projected_inflow_cents: input.amountCents,
			});
			const record =
				result && typeof result === "object"
					? (result as Record<string, unknown>)
					: {};
			const ref =
				(typeof record.ref === "string" && record.ref) ||
				(typeof record.id === "string" && record.id) ||
				`cfo:${input.investigationId}:${input.kind}`;
			return {
				ref,
				kind: input.kind,
				projectedInflowCents:
					pickCents(record.projected_inflow) ?? input.amountCents,
				assumptions: { source: "cfo.ai" },
				source: "cfo.ai",
			};
		} catch {
			// fall through to local model
		}
	}

	return {
		ref: `local:${input.investigationId}:${input.kind}`,
		kind: input.kind,
		projectedInflowCents: input.amountCents,
		assumptions: {
			source: "local-model",
			note: "Assumes the mitigation recovers the full outstanding amount.",
		},
		source: "local-model",
	};
}
