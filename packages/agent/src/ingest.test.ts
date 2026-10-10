import { describe, expect, test } from "bun:test";

import type { Database } from "@cube/db";

import { IngestError, ingestExternalFailedPayment } from "./ingest";

// Validation runs before any query, so a stub database is safe for these cases.
const db = {} as Database;

const base = {
	customerExternalId: "cus_123",
	amountCents: 1000,
	declineCode: "insufficient_funds",
};

describe("ingestExternalFailedPayment validation", () => {
	test("requires an idempotency key", async () => {
		await expect(
			ingestExternalFailedPayment(db, "proj", "", base),
		).rejects.toBeInstanceOf(IngestError);
	});

	test("requires a customer external id", async () => {
		await expect(
			ingestExternalFailedPayment(db, "proj", "key", {
				...base,
				customerExternalId: "",
			}),
		).rejects.toBeInstanceOf(IngestError);
	});

	test("rejects a non-positive amount", async () => {
		await expect(
			ingestExternalFailedPayment(db, "proj", "key", {
				...base,
				amountCents: 0,
			}),
		).rejects.toBeInstanceOf(IngestError);
	});

	test("rejects an unknown decline code", async () => {
		await expect(
			ingestExternalFailedPayment(db, "proj", "key", {
				...base,
				declineCode: "not_a_code",
			}),
		).rejects.toBeInstanceOf(IngestError);
	});
});
