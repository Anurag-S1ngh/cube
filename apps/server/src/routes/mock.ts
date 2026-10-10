import { Router } from "express";

import { accessibleProjectIds, getAuth, requireAuth } from "../auth/middleware";
import { simulateFailures } from "../mock/simulator";
import { db } from "../services";

export const mockRouter = Router();

mockRouter.use(requireAuth());

/**
 * Dev-only endpoint that fabricates failed charges against the caller's
 * project's overdue invoices so the whole pipeline can be exercised without a
 * real payment provider.
 */
mockRouter.post("/simulate", async (req, res) => {
	const auth = getAuth(res);
	if (!auth) {
		res.status(401).json({ error: "authentication required" });
		return;
	}
	const projectIds = await accessibleProjectIds(db, auth);
	if (projectIds.length === 0) {
		res.status(404).json({ error: "no project available" });
		return;
	}

	const requested = Number(req.query.count ?? 8);
	const count = Number.isFinite(requested)
		? Math.min(Math.max(requested, 1), 50)
		: 8;
	const results = await simulateFailures(count, projectIds);
	res.status(202).json({
		created: results.length,
		investigations: results.map((r) => r.investigationId),
	});
});
