import type { Database } from "@cube/db";
import {
	approvals,
	auditLog,
	causes,
	emailActions,
	investigations,
	mitigationScenarios,
	recommendations,
} from "@cube/db";
import { eq } from "drizzle-orm";

import { classify } from "./classify";
import { gatherContext } from "./context";
import { formatMoney } from "./format";
import { recommend } from "./mitigate";
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
 * Investigate one failed payment: gather context, classify the probable cause
 * and produce a recommended mitigation. Act (email) and observability are
 * layered on in later phases.
 */
export async function runInvestigation(
	db: Database,
	config: AgentConfig,
	investigationId: string,
): Promise<void> {
	await setStatus(db, investigationId, "investigating");

	try {
		const ctx = await gatherContext(db, investigationId);

		// Enrich with the customer's financial position (cfo.ai or ledger).
		const finance = await getFinancialContext(db, config, ctx);
		await db
			.update(investigations)
			.set({
				outstandingBalanceCents: finance.outstandingBalanceCents,
				revenueAtRiskCents: finance.revenueAtRiskCents,
				cfoEvidence: finance.evidence,
				updatedAt: new Date(),
			})
			.where(eq(investigations.id, investigationId));

		const classification = classify(ctx);

		await db.delete(causes).where(eq(causes.investigationId, investigationId));
		await db.insert(causes).values({
			investigationId,
			code: classification.code,
			label: classification.label,
			severity: classification.severity,
			confidence: classification.confidence,
			evidence: classification.evidence,
		});
		await setStatus(db, investigationId, "classified");

		const recommendation = recommend(ctx, classification);

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

		// Model the recovery as a deterministic cfo.ai scenario.
		const scenario = await createMitigationScenario(config, {
			investigationId,
			kind: classification.code,
			amountCents: recommendation.cashImpactCents,
			customer: ctx.customer.name ?? ctx.customer.externalId,
		});
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

		await act(db, config, investigationId, ctx, classification, recommendation);
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
	ctx: Awaited<ReturnType<typeof gatherContext>>,
	classification: ReturnType<typeof classify>,
	recommendation: ReturnType<typeof recommend>,
): Promise<void> {
	const emailAction = recommendation.actions.find(
		(a) => a.type === "email_reminder",
	);

	if (!emailAction) {
		// Nothing to send (e.g. silent retry, or a risk escalation).
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

	const policy = await evaluateOutreachPolicy(db, config, ctx, classification);
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
		await recordAudit(db, investigationId, "email_blocked", {
			reason: policy.reason,
			checks: policy.checks,
		});
		await setStatus(db, investigationId, "recommended");
		return;
	}

	const send = await sendEmail(config, {
		to,
		subject: rendered.subject,
		body: rendered.body,
	});
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
	await setStatus(db, investigationId, "actioned");
}
