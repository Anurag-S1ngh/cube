import type { Database } from "@cube/db";
import { invoices } from "@cube/db";
import { and, eq, sum } from "drizzle-orm";

import type { InvestigationContext } from "../context";
import { McpClient } from "../mcp/client";
import type { OAuthConfig } from "../mcp/oauth";
import { getAccessToken } from "../mcp/oauth";
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
let cachedOrg: { id: string; name?: string } | null = null;

function client(config: AgentConfig): McpClient | null {
	const oauth = config.cfo.oauth;
	if (!config.cfo.token && !oauth) return null;

	const key = `${config.cfo.mcpUrl}::${
		config.cfo.token ? "static" : (oauth?.credentialsPath ?? "")
	}`;
	if (!cachedClient || cachedKey !== key) {
		const oauthConfig: OAuthConfig | undefined = oauth
			? {
					mcpUrl: config.cfo.mcpUrl,
					credentialsPath: oauth.credentialsPath,
					redirectPort: oauth.redirectPort,
					scope: oauth.scope,
				}
			: undefined;
		cachedClient = new McpClient({
			url: config.cfo.mcpUrl,
			token: config.cfo.token,
			getToken: oauthConfig ? () => getAccessToken(oauthConfig) : undefined,
		});
		cachedKey = key;
	}
	return cachedClient;
}

/** Resolve the workspace id (cfo.ai tools take `org_id` as an argument). */
async function resolveOrg(
	mcp: McpClient,
	config: AgentConfig,
): Promise<{ id: string; name?: string } | null> {
	if (config.cfo.orgId) return { id: config.cfo.orgId };
	if (cachedOrg) return cachedOrg;
	try {
		const result = (await mcp.callTool("list_orgs", {})) as {
			orgs?: { org_id?: string; name?: string }[];
		};
		const first = result?.orgs?.[0];
		if (first?.org_id) {
			cachedOrg = { id: first.org_id, name: first.name };
			return cachedOrg;
		}
	} catch {
		// fall through
	}
	return null;
}

function toCents(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.round(value * 100);
	}
	if (typeof value === "string") {
		const parsed = Number(value.replace(/[^0-9.-]/g, ""));
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
	}
	return null;
}

/** Best-effort search of a cfo.ai response for a figure matching a key. */
function deepFindCents(
	node: unknown,
	pattern: RegExp,
	depth = 0,
): number | null {
	if (depth > 6 || node == null) return null;
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = deepFindCents(item, pattern, depth + 1);
			if (found != null) return found;
		}
		return null;
	}
	if (typeof node === "object") {
		for (const [key, value] of Object.entries(
			node as Record<string, unknown>,
		)) {
			if (pattern.test(key)) {
				const cents = toCents(value);
				if (cents != null) return cents;
			}
			const found = deepFindCents(value, pattern, depth + 1);
			if (found != null) return found;
		}
	}
	return null;
}

async function ledgerOutstandingCents(
	db: Database,
	ctx: InvestigationContext,
): Promise<number> {
	const [ledger] = await db
		.select({ total: sum(invoices.totalAmount) })
		.from(invoices)
		.where(
			and(
				eq(invoices.customerId, ctx.customer.id),
				eq(invoices.status, "pending"),
			),
		);
	return Math.round(Number(ledger?.total ?? 0) * 100);
}

/**
 * Read the customer's financial position from cfo.ai's model. When cfo.ai is
 * not configured, unreachable, or its model has no matching figures, fall back
 * to the Postgres ledger so the pipeline always has deterministic numbers.
 */
export async function getFinancialContext(
	db: Database,
	config: AgentConfig,
	ctx: InvestigationContext,
): Promise<FinancialContext> {
	const ledgerCents = await ledgerOutstandingCents(db, ctx);

	const mcp = client(config);
	if (mcp) {
		try {
			const org = await resolveOrg(mcp, config);
			const result = await mcp.callTool("inspect_table_blocks", {
				list: {},
				...(org ? { org_id: org.id } : {}),
			});

			const outstanding = deepFindCents(
				result,
				/outstanding|balance|receivable/i,
			);
			const atRisk = deepFindCents(result, /at.?risk|risk/i);
			const hasModelFigures = outstanding != null || atRisk != null;
			const blockCount = (result as { block_count?: number })?.block_count;

			if (hasModelFigures) {
				return {
					outstandingBalanceCents: outstanding ?? ledgerCents,
					revenueAtRiskCents: atRisk ?? outstanding ?? ledgerCents,
					source: "cfo.ai",
					evidence: {
						provider: "cfo.ai",
						org: org?.name ?? org?.id ?? null,
						basis: "cfo.ai-model",
						blockCount: blockCount ?? null,
					},
				};
			}

			return {
				outstandingBalanceCents: ledgerCents,
				revenueAtRiskCents: ledgerCents,
				source: "local-ledger",
				evidence: {
					provider: "local-ledger",
					cfoConnected: true,
					org: org?.name ?? org?.id ?? null,
					note: "cfo.ai model has no matching figures; using the ledger",
					blockCount: blockCount ?? null,
				},
			};
		} catch (error) {
			return {
				outstandingBalanceCents: ledgerCents,
				revenueAtRiskCents: ledgerCents,
				source: "local-ledger",
				evidence: {
					provider: "local-ledger",
					cfoConnected: false,
					reason: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	return {
		outstandingBalanceCents: ledgerCents,
		revenueAtRiskCents: ledgerCents,
		source: "local-ledger",
		evidence: {
			provider: "local-ledger",
			cfoConnected: false,
			pendingInvoices: ctx.paymentHistory.unpaid,
			overdueDays: ctx.overdueDays,
		},
	};
}

/**
 * Create a recovery scenario in cfo.ai (deterministic, changelogged and
 * reversible), falling back to a local projection when cfo.ai is unavailable.
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
			const org = await resolveOrg(mcp, config);
			const suffix = input.investigationId.slice(0, 8);
			const name = `Recovery: ${input.customer} (${input.kind}) · ${suffix}`;
			const result = (await mcp.callTool("edit_scenarios", {
				create: { name },
				...(org ? { org_id: org.id } : {}),
			})) as { scenario?: { ref?: string } };

			const ref = result?.scenario?.ref;
			if (typeof ref === "string" && ref.length > 0) {
				return {
					ref,
					kind: input.kind,
					projectedInflowCents: input.amountCents,
					assumptions: {
						source: "cfo.ai",
						org: org?.name ?? org?.id ?? null,
						note: "Assumes the mitigation recovers the full outstanding amount.",
					},
					source: "cfo.ai",
				};
			}
		} catch {
			// fall through to the local model
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
