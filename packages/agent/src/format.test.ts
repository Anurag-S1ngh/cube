import { describe, expect, test } from "bun:test";

import { formatMoney } from "./format";
import { renderEmail } from "./tools/email";

describe("formatMoney", () => {
	test("formats usd cents with a symbol", () => {
		expect(formatMoney(299900, "usd")).toBe("$2999.00");
	});
	test("falls back to a currency code", () => {
		expect(formatMoney(500, "aud")).toBe("5.00 AUD");
	});
});

describe("renderEmail", () => {
	const vars = {
		customerName: "Acme Corp",
		amountFormatted: "$29.99",
		invoiceNumber: "INV-001",
		updateLink: "https://pay.cube.test/update",
	};

	test("renders the requested template", () => {
		const email = renderEmail("reminder.expired_card", vars);
		expect(email.subject).toContain("INV-001");
		expect(email.body).toContain("Acme Corp");
		expect(email.body).toContain("https://pay.cube.test/update");
	});

	test("falls back to the generic template", () => {
		const email = renderEmail(undefined, vars);
		expect(email.subject).toContain("INV-001");
	});
});
