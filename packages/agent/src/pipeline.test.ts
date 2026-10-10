import { describe, expect, test } from "bun:test";

import { classify } from "./classify";
import type { InvestigationContext } from "./context";
import { recommend } from "./mitigate";

function context(
	overrides: Partial<InvestigationContext> = {},
): InvestigationContext {
	return {
		investigationId: "inv_test",
		event: {
			id: "evt_test",
			amountCents: 14900,
			currency: "usd",
			declineCode: "insufficient_funds",
			attemptNumber: 1,
			invoiceNumber: "INV-DEMO-001",
			receivedAt: new Date(),
		},
		customer: {
			id: "cus_test",
			name: "Acme Corp",
			email: "billing@acme.test",
			externalId: "cus_acme",
		},
		invoice: {
			id: "invs_test",
			status: "pending",
			totalAmount: 149,
			dueDate: new Date(Date.now() - 5 * 86_400_000),
		},
		priorFailureCount: 0,
		overdueDays: 5,
		paymentHistory: { paid: 3, unpaid: 0 },
		...overrides,
	};
}

describe("classify", () => {
	test("maps insufficient_funds to a soft cause", () => {
		const result = classify(context());
		expect(result.code).toBe("insufficient_funds");
		expect(result.severity).toBe("soft");
		expect(result.confidence).toBeGreaterThan(90);
	});

	test("maps fraudulent to a risk cause", () => {
		const result = classify(
			context({
				event: { ...context().event, declineCode: "fraudulent" },
			}),
		);
		expect(result.severity).toBe("risk");
		expect(result.code).toBe("fraudulent");
	});

	test("repeated failures lower confidence for soft declines", () => {
		const fresh = classify(context({ priorFailureCount: 0 }));
		const repeated = classify(context({ priorFailureCount: 4 }));
		expect(repeated.confidence).toBeLessThan(fresh.confidence);
	});
});

describe("recommend", () => {
	test("insufficient funds retries and emails", () => {
		const ctx = context();
		const rec = recommend(ctx, classify(ctx));
		expect(rec.retryScheduleDays).toEqual([3, 5, 7]);
		expect(rec.actions.some((a) => a.type === "email_reminder")).toBe(true);
	});

	test("fraud never retries or emails", () => {
		const ctx = context({
			event: { ...context().event, declineCode: "fraudulent" },
		});
		const rec = recommend(ctx, classify(ctx));
		expect(rec.retryScheduleDays).toEqual([]);
		expect(rec.actions.map((a) => a.type)).toEqual(["risk_escalation"]);
	});

	test("repeated soft failures switch to an alternative method", () => {
		const ctx = context({ priorFailureCount: 3 });
		const rec = recommend(ctx, classify(ctx));
		expect(rec.retryScheduleDays).toEqual([]);
		expect(rec.actions.some((a) => a.type === "alt_payment_method")).toBe(true);
	});
});
