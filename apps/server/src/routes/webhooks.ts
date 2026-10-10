import type { PaymentFailurePayload } from "@cube/agent";

import { IngestError, ingestFailedPayment, verifySignature } from "@cube/agent";
import { projects } from "@cube/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";

import { agentConfig } from "../config";
import { queue } from "../queue";
import { db } from "../services";
import type { RawBodyRequest } from "../types";

export const webhooksRouter = Router();

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payment provider webhook. The mock provider signs the raw body with
 * HMAC-SHA256; real providers use the same shape (e.g. Stripe-Signature).
 *
 * Mounted both as `/stripe` (global dev secret) and `/stripe/:projectId`
 * (per-project secret), so a real multi-tenant deployment signs each project's
 * webhooks with its own secret.
 */
async function handleStripe(
	req: Request,
	res: Response,
	projectIdParam?: string,
): Promise<void> {
	const raw = (req as RawBodyRequest).rawBody;
	const signature = req.header("x-mock-signature");

	if (!raw) {
		res.status(400).json({ error: "missing raw body" });
		return;
	}

	let secret = agentConfig.mockWebhookSecret;
	let expectedProjectId: string | undefined;

	if (projectIdParam) {
		if (!uuidPattern.test(projectIdParam)) {
			res.status(404).json({ error: "unknown project" });
			return;
		}
		const [project] = await db
			.select({
				id: projects.id,
				webhookSecret: projects.webhookSecret,
			})
			.from(projects)
			.where(eq(projects.id, projectIdParam))
			.limit(1);
		if (!project) {
			res.status(404).json({ error: "unknown project" });
			return;
		}
		expectedProjectId = project.id;
		if (project.webhookSecret) secret = project.webhookSecret;
	}

	const valid = verifySignature(raw.toString("utf8"), signature, secret);
	if (!valid) {
		res.status(401).json({ error: "invalid signature" });
		return;
	}

	const payload = req.body as PaymentFailurePayload;
	if (payload?.type !== "invoice.payment_failed") {
		res.status(400).json({ error: "unsupported event type" });
		return;
	}
	if (!payload.data?.customerId || !payload.data.declineCode) {
		res.status(400).json({ error: "malformed payload" });
		return;
	}

	let result: Awaited<ReturnType<typeof ingestFailedPayment>>;
	try {
		result = await ingestFailedPayment(db, payload, expectedProjectId);
	} catch (error) {
		if (error instanceof IngestError) {
			res.status(400).json({ error: error.message });
			return;
		}
		throw error;
	}
	if (!result.duplicate) {
		queue.enqueue(result.investigationId);
	}
	res.status(result.duplicate ? 200 : 202).json(result);
}

webhooksRouter.post("/stripe", (req, res) => handleStripe(req, res));

webhooksRouter.post("/stripe/:projectId", (req, res) => {
	const projectId =
		typeof req.params.projectId === "string" ? req.params.projectId : undefined;
	return handleStripe(req, res, projectId);
});
