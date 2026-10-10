import { ApprovalError, decideEmail } from "@cube/agent";
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
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";

import { accessibleProjectIds, getAuth, requireAuth } from "../auth/middleware";
import { agentConfig } from "../config";
import { db } from "../services";

export const investigationsRouter = Router();

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every route below is scoped to the caller's projects (all owned projects for
// a dashboard session, or the single project of an API key).
investigationsRouter.use(requireAuth());

async function callerProjectIds(res: Response): Promise<string[]> {
	const auth = getAuth(res);
	if (!auth) return [];
	return accessibleProjectIds(db, auth);
}

/** True only if the investigation's customer belongs to an allowed project. */
async function investigationInScope(
	id: string,
	projectIds: string[],
): Promise<boolean> {
	if (projectIds.length === 0) return false;
	const [row] = await db
		.select({ projectId: customers.projectId })
		.from(investigations)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.where(eq(investigations.id, id))
		.limit(1);
	return Boolean(row && projectIds.includes(row.projectId));
}

/** Shared handler for the human-in-the-loop email approval endpoints. */
async function decide(
	req: Request,
	res: Response,
	decision: "approved" | "rejected",
): Promise<void> {
	const id = typeof req.params.id === "string" ? req.params.id : "";
	if (!id || !uuidPattern.test(id)) {
		res.status(404).json({ error: "investigation not found" });
		return;
	}

	const projectIds = await callerProjectIds(res);
	if (!(await investigationInScope(id, projectIds))) {
		res.status(404).json({ error: "investigation not found" });
		return;
	}

	const body = (req.body ?? {}) as { actor?: unknown; reason?: unknown };
	try {
		const outcome = await decideEmail(db, agentConfig, {
			investigationId: id,
			decision,
			actor: typeof body.actor === "string" ? body.actor : undefined,
			reason: typeof body.reason === "string" ? body.reason : undefined,
		});
		res.json(outcome);
	} catch (error) {
		if (error instanceof ApprovalError) {
			res.status(409).json({ error: error.message });
			return;
		}
		throw error;
	}
}

investigationsRouter.post("/:id/approve", (req, res) =>
	decide(req, res, "approved"),
);

investigationsRouter.post("/:id/reject", (req, res) =>
	decide(req, res, "rejected"),
);

investigationsRouter.get("/summary", async (_req, res) => {
	const projectIds = await callerProjectIds(res);
	if (projectIds.length === 0) {
		res.json({
			total: 0,
			byStatus: {},
			revenueAtRiskCents: 0,
			emailsSent: 0,
			emailsBlocked: 0,
		});
		return;
	}

	const rows = await db
		.select({
			status: investigations.status,
			revenueAtRiskCents: investigations.revenueAtRiskCents,
		})
		.from(investigations)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.where(inArray(customers.projectId, projectIds));

	const byStatus: Record<string, number> = {};
	let revenueAtRiskCents = 0;
	for (const row of rows) {
		byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
		revenueAtRiskCents += row.revenueAtRiskCents ?? 0;
	}

	const emails = await db
		.select({ status: emailActions.status })
		.from(emailActions)
		.innerJoin(
			investigations,
			eq(investigations.id, emailActions.investigationId),
		)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.where(inArray(customers.projectId, projectIds));
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
	const projectIds = await callerProjectIds(res);
	if (projectIds.length === 0) {
		res.json({ investigations: [] });
		return;
	}

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
		.where(inArray(customers.projectId, projectIds))
		.orderBy(desc(investigations.createdAt))
		.limit(100);

	res.json({ investigations: rows });
});

investigationsRouter.get("/:id", async (req, res) => {
	const id = typeof req.params.id === "string" ? req.params.id : "";
	if (!id || !uuidPattern.test(id)) {
		res.status(404).json({ error: "investigation not found" });
		return;
	}

	const projectIds = await callerProjectIds(res);
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
		.where(
			and(
				eq(investigations.id, id),
				inArray(customers.projectId, projectIds.length ? projectIds : [""]),
			),
		)
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
