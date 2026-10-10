import type { PaymentFailurePayload } from "@cube/agent";

import { ingestFailedPayment, verifySignature } from "@cube/agent";
import { Router } from "express";

import { agentConfig } from "../config";
import { queue } from "../queue";
import { db } from "../services";
import type { RawBodyRequest } from "../types";

export const webhooksRouter = Router();

/**
 * Payment provider webhook. The mock provider signs the raw body with
 * HMAC-SHA256; real providers use the same shape (e.g. Stripe-Signature).
 */
webhooksRouter.post("/stripe", async (req, res) => {
	const raw = (req as RawBodyRequest).rawBody;
	const signature = req.header("x-mock-signature");

	if (!raw) {
		res.status(400).json({ error: "missing raw body" });
		return;
	}

	const valid = verifySignature(
		raw.toString("utf8"),
		signature,
		agentConfig.mockWebhookSecret,
	);
	if (!valid) {
		res.status(401).json({ error: "invalid signature" });
		return;
	}

	const payload = req.body as PaymentFailurePayload;
	if (!payload || payload.type !== "invoice.payment_failed") {
		res.status(400).json({ error: "unsupported event type" });
		return;
	}
	if (!payload.data?.customerId || !payload.data.declineCode) {
		res.status(400).json({ error: "malformed payload" });
		return;
	}

	const result = await ingestFailedPayment(db, payload);
	if (!result.duplicate) {
		queue.enqueue(result.investigationId);
	}
	res.status(result.duplicate ? 200 : 202).json(result);
});
