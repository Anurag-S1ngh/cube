import { ApprovalError, decideEmail } from "@cube/agent";
import type { InvestigationStatus } from "@cube/db";
import {
	agentRuns,
	auditLog,
	causes,
	customers,
	emailActions,
	failedPaymentEvents,
	investigationStatuses,
	investigations,
	mitigationScenarios,
	recommendations,
} from "@cube/db";
import type { SQL } from "drizzle-orm";
import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";

import { accessibleProjectIds, getAuth, requireAuth } from "../auth/middleware";
import { agentConfig } from "../config";
import { db } from "../services";

export const investigationsRouter = Router();

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const causeSeverities = ["soft", "hard", "risk"] as const;
type CauseSeverity = (typeof causeSeverities)[number];

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
			emailsQueued: 0,
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
	const emailsQueued = emails.filter((e) => e.status === "queued").length;

	res.json({
		total: rows.length,
		byStatus,
		revenueAtRiskCents,
		emailsSent,
		emailsBlocked,
		emailsQueued,
	});
});

investigationsRouter.get("/", async (req, res) => {
	const projectIds = await callerProjectIds(res);
	if (projectIds.length === 0) {
		res.json({ investigations: [], total: 0, page: 1, pageSize: 25 });
		return;
	}

	const page = Math.max(1, Number(req.query.page) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
	const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
	const status = typeof req.query.status === "string" ? req.query.status : "";
	const severity =
		typeof req.query.severity === "string" ? req.query.severity : "";
	const sort =
		typeof req.query.sort === "string" ? req.query.sort : "createdAt";
	const direction = req.query.order === "asc" ? asc : desc;

	const conditions = [inArray(customers.projectId, projectIds)];
	if ((investigationStatuses as readonly string[]).includes(status)) {
		conditions.push(eq(investigations.status, status as InvestigationStatus));
	}
	if ((causeSeverities as readonly string[]).includes(severity)) {
		conditions.push(eq(causes.severity, severity as CauseSeverity));
	}
	if (search) {
		const like = `%${search}%`;
		const match = or(
			ilike(customers.name, like),
			ilike(customers.email, like),
			ilike(failedPaymentEvents.declineCode, like),
			ilike(causes.code, like),
		);
		if (match) conditions.push(match);
	}
	const where = and(...conditions);

	let orderBy: SQL<unknown>;
	if (sort === "amount") orderBy = direction(failedPaymentEvents.amountCents);
	else if (sort === "confidence") orderBy = direction(causes.confidence);
	else orderBy = direction(investigations.createdAt);
	const baseFrom = db
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
		.leftJoin(causes, eq(causes.investigationId, investigations.id));

	const rows = await baseFrom
		.where(where)
		.orderBy(orderBy)
		.limit(pageSize)
		.offset((page - 1) * pageSize);

	const [counted] = await db
		.select({ value: count() })
		.from(investigations)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.innerJoin(
			failedPaymentEvents,
			eq(failedPaymentEvents.id, investigations.eventId),
		)
		.leftJoin(causes, eq(causes.investigationId, investigations.id))
		.where(where);

	res.json({
		investigations: rows,
		total: Number(counted?.value ?? 0),
		page,
		pageSize,
	});
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
