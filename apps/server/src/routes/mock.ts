import { Router } from "express";

import { simulateFailures } from "../mock/simulator";

export const mockRouter = Router();

/**
 * Dev-only endpoint that fabricates failed charges against the demo project's
 * overdue invoices so the whole pipeline can be exercised without a real
 * payment provider.
 */
mockRouter.post("/simulate", async (req, res) => {
	const requested = Number(req.query.count ?? 8);
	const count = Number.isFinite(requested)
		? Math.min(Math.max(requested, 1), 50)
		: 8;
	const results = await simulateFailures(count);
	res.status(202).json({
		created: results.length,
		investigations: results.map((r) => r.investigationId),
	});
});
