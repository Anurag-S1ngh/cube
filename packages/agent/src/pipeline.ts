import type { Database } from "@cube/db";
import {
	agentRuns,
	approvals,
	auditLog,
	causes,
	emailActions,
	investigations,
	mitigationScenarios,
	recommendations,
} from "@cube/db";
import { eq } from "drizzle-orm";

import type { Classification } from "./classify";
import { classify } from "./classify";
import type { InvestigationContext } from "./context";
import { gatherContext } from "./context";
import { formatMoney } from "./format";
import type { RecommendationResult } from "./mitigate";
import { recommend } from "./mitigate";
import { logStep, withSpan, withWorkflow } from "./observability";
import { evaluateOutreachPolicy } from "./policy";
import { createMitigationScenario, getFinancialContext } from "./tools/cfo";
import { renderEmail, sendEmail } from "./tools/email";
import type { AgentConfig } from "./types";

async function setStatus(
	db: Database,
	investigationId: string,
	status: (typeof investigations.$inferInsert)["status"],
	error?: string,
): Promise<void> {
	await db
		.update(investigations)
		.set({
			status,
			error: error ?? null,
			updatedAt: new Date(),
			...(status === "resolved" || status === "escalated"
				? { closedAt: new Date() }
				: {}),
		})
		.where(eq(investigations.id, investigationId));
}

async function recordAudit(
	db: Database,
	investigationId: string,
	action: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await db.insert(auditLog).values({
		entity: "investigation",
		entityId: investigationId,
		action,
		actor: "agent",
		payload,
	});
}

/**
 * Investigate one failed payment inside a single neatlogs workflow trace.
 * Every step (tool call, agent step, guardrail, email) is a nested span.
 */
export async function runInvestigation(
	db: Database,
	config: AgentConfig,
	investigationId: string,
): Promise<void> {
	const startedAt = Date.now();
	await setStatus(db, investigationId, "investigating");

	try {
		await withWorkflow(
			`investigation:${investigationId}`,
			{ investigationId },
			async (traceId) => {
				await db
					.update(investigations)
					.set({ neatlogsTraceId: traceId, updatedAt: new Date() })
					.where(eq(investigations.id, investigationId));

				const ctx = await withSpan(
					"context.fetch_history",
					"TOOL",
					{ investigationId },
					() => gatherContext(db, investigationId),
				);

				const finance = await withSpan(
					"cfo.query_model",
					"MCP_TOOL",
					{ customer: ctx.customer.externalId },
					() => getFinancialContext(db, config, ctx),
				);
				await db
					.update(investigations)
					.set({
						outstandingBalanceCents: finance.outstandingBalanceCents,
						revenueAtRiskCents: finance.revenueAtRiskCents,
						cfoEvidence: finance.evidence,
						updatedAt: new Date(),
					})
					.where(eq(investigations.id, investigationId));

				const classification = await withSpan(
					"classify.cause",
					"AGENT",
					{ declineCode: ctx.event.declineCode },
					async () => classify(ctx),
				);
				logStep("cause_classified", {
					code: classification.code,
					severity: classification.severity,
					confidence: classification.confidence,
				});

				await db
					.delete(causes)
					.where(eq(causes.investigationId, investigationId));
				await db.insert(causes).values({
					investigationId,
					code: classification.code,
					label: classification.label,
					severity: classification.severity,
					confidence: classification.confidence,
					evidence: classification.evidence,
				});
				await setStatus(db, investigationId, "classified");

				const recommendation = await withSpan(
					"recommend.mitigation",
					"AGENT",
					{ severity: classification.severity },
					async () => recommend(ctx, classification),
				);

				await db
					.delete(recommendations)
					.where(eq(recommendations.investigationId, investigationId));
				await db.insert(recommendations).values({
					investigationId,
					summary: recommendation.summary,
					rationale: recommendation.rationale,
					actions: recommendation.actions,
					cashImpactCents: recommendation.cashImpactCents,
				});

				const scenario = await withSpan(
					"cfo.create_scenario",
					"MCP_TOOL",
					{ kind: classification.code },
					() =>
						createMitigationScenario(config, {
							investigationId,
							kind: classification.code,
							amountCents: recommendation.cashImpactCents,
							customer: ctx.customer.name ?? ctx.customer.externalId,
						}),
				);
				await db
					.delete(mitigationScenarios)
					.where(eq(mitigationScenarios.investigationId, investigationId));
				await db.insert(mitigationScenarios).values({
					investigationId,
					cfoRef: scenario.ref,
					kind: scenario.kind,
					projectedInflowCents: scenario.projectedInflowCents,
					assumptions: scenario.assumptions,
				});
				await db
					.update(investigations)
					.set({ cfoScenarioRef: scenario.ref, updatedAt: new Date() })
					.where(eq(investigations.id, investigationId));

				await recordAudit(db, investigationId, "classified", {
					cause: classification.code,
					confidence: classification.confidence,
					severity: classification.severity,
					financeSource: finance.source,
				});
				await recordAudit(db, investigationId, "recommended", {
					actions: recommendation.actions.map((a) => a.type),
					retryScheduleDays: recommendation.retryScheduleDays,
					scenarioRef: scenario.ref,
					scenarioSource: scenario.source,
				});

				await act(
					db,
					config,
					investigationId,
					ctx,
					classification,
					recommendation,
				);

				await db.insert(agentRuns).values({
					investigationId,
					pipelineState: "completed",
					model: config.llm.model,
					latencyMs: Date.now() - startedAt,
					neatlogsTraceId: traceId,
				});
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await setStatus(db, investigationId, "failed", message);
		await recordAudit(db, investigationId, "failed", { error: message });
		throw error;
	}
}

/**
 * Execute the recommended actions. In full auto-send mode a guardrail still
 * runs before any customer email, and its outcome is recorded for audit.
 */
async function act(
	db: Database,
	config: AgentConfig,
	investigationId: string,
	ctx: InvestigationContext,
	classification: Classification,
	recommendation: RecommendationResult,
): Promise<void> {
	const emailAction = recommendation.actions.find(
		(a) => a.type === "email_reminder",
	);

	if (!emailAction) {
		await db
			.delete(emailActions)
			.where(eq(emailActions.investigationId, investigationId));
		if (classification.severity === "risk") {
			await recordAudit(db, investigationId, "escalated", {
				reason: classification.label,
			});
			await setStatus(db, investigationId, "escalated");
			return;
		}
		await recordAudit(db, investigationId, "actioned", {
			actions: recommendation.actions.map((a) => a.type),
		});
		await setStatus(db, investigationId, "actioned");
		return;
	}

	const policy = await withSpan(
		"policy.pre_send",
		"GUARDRAIL",
		{ severity: classification.severity },
		() => evaluateOutreachPolicy(db, config, ctx, classification),
	);

	const to = ctx.customer.email ?? "";
	const vars = {
		customerName: ctx.customer.name ?? "there",
		amountFormatted: formatMoney(ctx.event.amountCents, ctx.event.currency),
		invoiceNumber: ctx.event.invoiceNumber ?? "your invoice",
		updateLink: `https://pay.cube.test/update?invoice=${encodeURIComponent(
			ctx.event.invoiceNumber ?? "",
		)}&customer=${encodeURIComponent(ctx.customer.externalId)}`,
	};
	const rendered = renderEmail(emailAction.templateId, vars);

	await db
		.delete(emailActions)
		.where(eq(emailActions.investigationId, investigationId));

	if (!policy.allowed) {
		await db.insert(emailActions).values({
			investigationId,
			templateId: emailAction.templateId ?? "reminder.generic_decline",
			to,
			subject: rendered.subject,
			body: rendered.body,
			status: "blocked",
			provider: config.email.provider,
			blockReason: policy.reason ?? "blocked by policy",
		});
		logStep("email_blocked", {
			reason: policy.reason ?? "blocked by policy",
			checks: policy.checks,
		});
		await recordAudit(db, investigationId, "email_blocked", {
			reason: policy.reason,
			checks: policy.checks,
		});
		await setStatus(db, investigationId, "recommended");
		return;
	}

	let send: Awaited<ReturnType<typeof sendEmail>>;
	try {
		send = await withSpan(
			"email.send",
			"TOOL",
			{ templateId: emailAction.templateId, provider: config.email.provider },
			() =>
				sendEmail(config, {
					to,
					subject: rendered.subject,
					body: rendered.body,
				}),
		);
	} catch (error) {
		// The provider rejected the send (bad key, unverified domain, outage).
		// Record the failure instead of failing the whole investigation.
		const reason = error instanceof Error ? error.message : String(error);
		await db.insert(emailActions).values({
			investigationId,
			templateId: emailAction.templateId ?? "reminder.generic_decline",
			to,
			subject: rendered.subject,
			body: rendered.body,
			status: "failed",
			provider: config.email.provider,
			blockReason: reason,
		});
		await recordAudit(db, investigationId, "email_failed", { reason });
		logStep("email_failed", { reason });
		await setStatus(db, investigationId, "recommended");
		return;
	}

	await db.insert(emailActions).values({
		investigationId,
		templateId: emailAction.templateId ?? "reminder.generic_decline",
		to,
		subject: rendered.subject,
		body: rendered.body,
		status: "sent",
		provider: send.provider,
		providerMessageId: send.providerMessageId,
		sentAt: new Date(),
	});
	await db.insert(approvals).values({
		investigationId,
		actor: "agent",
		decision: "auto",
		reason: "auto-send mode",
		metadata: { checks: policy.checks },
	});
	await recordAudit(db, investigationId, "email_sent", {
		templateId: emailAction.templateId,
		provider: send.provider,
		providerMessageId: send.providerMessageId,
		checks: policy.checks,
	});
	logStep("email_sent", {
		templateId: emailAction.templateId,
		provider: send.provider,
	});
	await setStatus(db, investigationId, "actioned");
}
