import { describe, expect, test } from "bun:test";

import type { Database } from "@cube/db";

import type { Classification } from "./classify";
import type { InvestigationContext } from "./context";
import { evaluateOutreachPolicy } from "./policy";
import type { AgentConfig } from "./types";

function fakeDb(sentLast24h: number): Database {
	return {
		select: () => ({
			from: () => ({
				where: async () => [{ value: sentLast24h }],
			}),
		}),
	} as unknown as Database;
}

const config = {
	email: { provider: "mock", from: "billing@cube.test" },
} as unknown as AgentConfig;

function ctx(
	overrides: Partial<InvestigationContext> = {},
): InvestigationContext {
	return {
		investigationId: "inv",
		event: {
			id: "evt",
			amountCents: 14900,
			currency: "usd",
			declineCode: "insufficient_funds",
			attemptNumber: 1,
			invoiceNumber: "INV-1",
			receivedAt: new Date(),
		},
		customer: {
			id: "cus",
			name: "Acme",
			email: "billing@acme.test",
			externalId: "cus_acme",
		},
		invoice: null,
		priorFailureCount: 0,
		overdueDays: 0,
		paymentHistory: { paid: 1, unpaid: 0 },
		...overrides,
	};
}

function classification(severity: Classification["severity"]): Classification {
	return { code: "x", label: "X", severity, confidence: 90, evidence: {} };
}

// 2pm on a weekday — outside quiet hours, so the time check does not interfere.
const daytime = new Date("2026-06-01T14:00:00");

describe("evaluateOutreachPolicy", () => {
	test("allows a normal soft-decline email", async () => {
		const decision = await evaluateOutreachPolicy(
			fakeDb(0),
			config,
			ctx(),
			classification("soft"),
			daytime,
		);
		expect(decision.allowed).toBe(true);
	});

	test("blocks risk-flagged charges", async () => {
		const decision = await evaluateOutreachPolicy(
			fakeDb(0),
			config,
			ctx(),
			classification("risk"),
			daytime,
		);
		expect(decision.allowed).toBe(false);
		expect(decision.checks.notRisk).toBe(false);
	});

	test("blocks when the customer has no email", async () => {
		const decision = await evaluateOutreachPolicy(
			fakeDb(0),
			config,
			ctx({ customer: { id: "c", name: "X", email: null, externalId: "e" } }),
			classification("soft"),
			daytime,
		);
		expect(decision.allowed).toBe(false);
	});

	test("blocks when the rate limit is reached", async () => {
		const decision = await evaluateOutreachPolicy(
			fakeDb(3),
			config,
			ctx(),
			classification("soft"),
			daytime,
		);
		expect(decision.allowed).toBe(false);
		expect(decision.checks.underRateLimit).toBe(false);
	});

	test("blocks during quiet hours", async () => {
		const decision = await evaluateOutreachPolicy(
			fakeDb(0),
			config,
			ctx(),
			classification("soft"),
			new Date("2026-06-01T23:30:00"),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.checks.outsideQuietHours).toBe(false);
	});
});
