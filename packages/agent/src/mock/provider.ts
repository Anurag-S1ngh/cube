import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { DeclineCode } from "@cube/db";

import type { PaymentFailurePayload } from "../types";

const declineMessages: Record<DeclineCode, string> = {
	insufficient_funds: "Your card has insufficient funds.",
	expired_card: "Your card has expired.",
	authentication_required:
		"This charge requires authentication that was not completed.",
	do_not_honor: "Your card was declined (do not honor).",
	processing_error: "A processing error occurred. Please try again.",
	invalid_account: "The account details are invalid.",
	fraudulent: "The charge was flagged as fraudulent.",
	stolen_card: "The card was reported stolen.",
	lost_card: "The card was reported lost.",
	card_not_supported: "The card is not supported.",
	generic_decline: "Your card was declined.",
};

const brands = ["visa", "mastercard", "amex", "discover"];

function last4(seed: string): string {
	let hash = 0;
	for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return String(hash % 10000).padStart(4, "0");
}

export type FailureInput = {
	projectId: string | null;
	customerId: string;
	customerExternalId: string;
	customerName?: string | null;
	customerEmail?: string | null;
	invoiceId: string | null;
	invoiceNumber: string | null;
	amountCents: number;
	currency: string;
	declineCode: DeclineCode;
	attemptNumber?: number;
};

export function generateFailurePayload(
	input: FailureInput,
): PaymentFailurePayload {
	const attemptNumber = input.attemptNumber ?? 1;
	return {
		id: `evt_mock_${randomUUID()}`,
		provider: "mock",
		type: "invoice.payment_failed",
		createdAt: new Date().toISOString(),
		data: {
			projectId: input.projectId,
			customerExternalId: input.customerExternalId,
			customerId: input.customerId,
			invoiceId: input.invoiceId,
			invoiceNumber: input.invoiceNumber,
			amountCents: input.amountCents,
			currency: input.currency.toLowerCase(),
			declineCode: input.declineCode,
			declineMessage: declineMessages[input.declineCode],
			attemptNumber,
			paymentMethod: {
				brand: brands[attemptNumber % brands.length] ?? "visa",
				last4: last4(input.customerExternalId),
				expMonth: 1 + (attemptNumber % 12),
				expYear: 2025 + (attemptNumber % 3),
			},
			customer: {
				name: input.customerName ?? null,
				email: input.customerEmail ?? null,
			},
		},
	};
}

export function signPayload(body: string, secret: string): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(
	body: string,
	signature: string | undefined,
	secret: string,
): boolean {
	if (!signature) return false;
	const expected = signPayload(body, secret);
	const a = Buffer.from(expected);
	const b = Buffer.from(signature);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

// A representative mix of decline codes used by the CLI simulator.
export const demoDeclineSequence: DeclineCode[] = [
	"insufficient_funds",
	"expired_card",
	"authentication_required",
	"do_not_honor",
	"processing_error",
	"fraudulent",
	"card_not_supported",
	"generic_decline",
];
