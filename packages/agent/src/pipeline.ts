import type { Database } from "@cube/db";
import { auditLog, causes, investigations, recommendations } from "@cube/db";
import { eq } from "drizzle-orm";

import { classify } from "./classify";
import { gatherContext } from "./context";
import { recommend } from "./mitigate";
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
	_config: AgentConfig,
	investigationId: string,
): Promise<void> {
	await setStatus(db, investigationId, "investigating");

	try {
		const ctx = await gatherContext(db, investigationId);
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

		await recordAudit(db, investigationId, "classified", {
			cause: classification.code,
			confidence: classification.confidence,
			severity: classification.severity,
		});
		await recordAudit(db, investigationId, "recommended", {
			actions: recommendation.actions.map((a) => a.type),
			retryScheduleDays: recommendation.retryScheduleDays,
		});

		await setStatus(db, investigationId, "recommended");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await setStatus(db, investigationId, "failed", message);
		await recordAudit(db, investigationId, "failed", { error: message });
		throw error;
	}
}
