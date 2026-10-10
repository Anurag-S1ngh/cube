import { IngestError, ingestExternalFailedPayment } from "@cube/agent";
import { Router } from "express";

import { getAuth, requireApiKey } from "../auth/middleware";
import { queue } from "../queue";
import { db } from "../services";

export const eventsRouter = Router();

// Machine-only: tenants push normalized events with a project API key.
eventsRouter.use(requireApiKey());

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function obj(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function idempotencyKey(req: {
	header: (name: string) => string | undefined;
	body: Record<string, unknown>;
}): string | undefined {
	return (
		str(req.header("idempotency-key")) ??
		str(req.body.idempotencyKey) ??
		str(req.body.id)
	);
}

/**
 * Raise an investigation from a tenant's own billing system, without wiring a
 * payment-provider webhook. Idempotent on the `Idempotency-Key` header.
 */
eventsRouter.post("/failed-payment", async (req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "apiKey") {
		res.status(401).json({ error: "API key required" });
		return;
	}

	const body = (req.body ?? {}) as Record<string, unknown>;
	const key = idempotencyKey({ header: (n) => req.header(n), body });
	if (!key) {
		res.status(400).json({ error: "an Idempotency-Key header is required" });
		return;
	}

	const paymentMethod = obj(body.paymentMethod);
	let result: Awaited<ReturnType<typeof ingestExternalFailedPayment>>;
	try {
		result = await ingestExternalFailedPayment(db, auth.key.projectId, key, {
			customerExternalId: str(body.customerExternalId) ?? "",
			customer: obj(body.customer)
				? {
						name: str(obj(body.customer)?.name) ?? null,
						email: str(obj(body.customer)?.email) ?? null,
					}
				: undefined,
			invoiceNumber: str(body.invoiceNumber) ?? null,
			amountCents: Number(body.amountCents),
			currency: str(body.currency),
			declineCode: str(body.declineCode) ?? "",
			attemptNumber:
				typeof body.attemptNumber === "number" ? body.attemptNumber : undefined,
			provider: str(body.provider),
			occurredAt: str(body.occurredAt),
			paymentMethod: paymentMethod
				? {
						brand: str(paymentMethod.brand),
						last4: str(paymentMethod.last4),
						expMonth:
							typeof paymentMethod.expMonth === "number"
								? paymentMethod.expMonth
								: undefined,
						expYear:
							typeof paymentMethod.expYear === "number"
								? paymentMethod.expYear
								: undefined,
					}
				: undefined,
			createCustomerIfMissing: body.createCustomerIfMissing !== false,
		});
	} catch (error) {
		if (error instanceof IngestError) {
			res.status(422).json({ error: error.message });
			return;
		}
		throw error;
	}

	if (!result.duplicate) {
		queue.enqueue(result.investigationId);
	}
	res.status(result.duplicate ? 200 : 202).json(result);
});
