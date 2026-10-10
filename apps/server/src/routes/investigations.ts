import {
	agentRuns,
	auditLog,
	causes,
	customers,
	emailActions,
	failedPaymentEvents,
	investigations,
	mitigationScenarios,
	recommendations,
} from "@cube/db";
import { desc, eq } from "drizzle-orm";
import { Router } from "express";

import { db } from "../services";

export const investigationsRouter = Router();

investigationsRouter.get("/summary", async (_req, res) => {
	const rows = await db
		.select({
			status: investigations.status,
			revenueAtRiskCents: investigations.revenueAtRiskCents,
		})
		.from(investigations);

	const byStatus: Record<string, number> = {};
	let revenueAtRiskCents = 0;
	for (const row of rows) {
		byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
		revenueAtRiskCents += row.revenueAtRiskCents ?? 0;
	}

	const emails = await db
		.select({ status: emailActions.status })
		.from(emailActions);
	const emailsSent = emails.filter((e) => e.status === "sent").length;
	const emailsBlocked = emails.filter((e) => e.status === "blocked").length;

	res.json({
		total: rows.length,
		byStatus,
		revenueAtRiskCents,
		emailsSent,
		emailsBlocked,
	});
});

investigationsRouter.get("/", async (_req, res) => {
	const rows = await db
		.select({
			id: investigations.id,
			status: investigations.status,
			createdAt: investigations.createdAt,
			customerName: customers.name,
			customerEmail: customers.email,
			amountCents: failedPaymentEvents.amountCents,
			currency: failedPaymentEvents.currency,
			declineCode: failedPaymentEvents.declineCode,
			causeCode: causes.code,
			confidence: causes.confidence,
			severity: causes.severity,
			revenueAtRiskCents: investigations.revenueAtRiskCents,
			neatlogsTraceId: investigations.neatlogsTraceId,
			cfoScenarioRef: investigations.cfoScenarioRef,
		})
		.from(investigations)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.innerJoin(
			failedPaymentEvents,
			eq(failedPaymentEvents.id, investigations.eventId),
		)
		.leftJoin(causes, eq(causes.investigationId, investigations.id))
		.orderBy(desc(investigations.createdAt))
		.limit(100);

	res.json({ investigations: rows });
});

investigationsRouter.get("/:id", async (req, res) => {
	const { id } = req.params;

	const [row] = await db
		.select({
			investigation: investigations,
			customer: customers,
			event: failedPaymentEvents,
		})
		.from(investigations)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.innerJoin(
			failedPaymentEvents,
			eq(failedPaymentEvents.id, investigations.eventId),
		)
		.where(eq(investigations.id, id))
		.limit(1);

	if (!row) {
		res.status(404).json({ error: "investigation not found" });
		return;
	}

	const [cause] = await db
		.select()
		.from(causes)
		.where(eq(causes.investigationId, id))
		.limit(1);
	const [recommendation] = await db
		.select()
		.from(recommendations)
		.where(eq(recommendations.investigationId, id))
		.limit(1);
	const scenarios = await db
		.select()
		.from(mitigationScenarios)
		.where(eq(mitigationScenarios.investigationId, id));
	const emails = await db
		.select()
		.from(emailActions)
		.where(eq(emailActions.investigationId, id));
	const timeline = await db
		.select()
		.from(auditLog)
		.where(eq(auditLog.entityId, id))
		.orderBy(auditLog.at);
	const runs = await db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.investigationId, id));

	res.json({
		...row,
		cause: cause ?? null,
		recommendation: recommendation ?? null,
		scenarios,
		emails,
		timeline,
		runs,
	});
});
