import {
	causes,
	customers,
	emailActions,
	failedPaymentEvents,
	investigations,
	recommendations,
} from "@cube/db";
import { desc, eq } from "drizzle-orm";
import { Router } from "express";

import { db } from "../services";

export const investigationsRouter = Router();

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

	const [investigation] = await db
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

	if (!investigation) {
		res.status(404).json({ error: "investigation not found" });
		return;
	}

	const [causeRow] = await db
		.select()
		.from(causes)
		.where(eq(causes.investigationId, id))
		.limit(1);
	const [recommendationRow] = await db
		.select()
		.from(recommendations)
		.where(eq(recommendations.investigationId, id))
		.limit(1);
	const emails = await db
		.select()
		.from(emailActions)
		.where(eq(emailActions.investigationId, id));

	res.json({
		...investigation,
		cause: causeRow ?? null,
		recommendation: recommendationRow ?? null,
		emails,
	});
});
