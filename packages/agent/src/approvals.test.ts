import { describe, expect, test } from "bun:test";

import type { Database } from "@cube/db";

import { ApprovalError, decideEmail } from "./approvals";
import type { AgentConfig } from "./types";

const config: AgentConfig = {
	llm: { baseUrl: "http://localhost", model: "test" },
	email: { provider: "mock", from: "billing@cube.test" },
	cfo: { mcpUrl: "http://localhost" },
	neatlogs: {},
	mockWebhookSecret: "test",
	autoSend: false,
};

// The db is only touched after validation, so a stub is safe for these cases.
const db = {} as Database;

describe("decideEmail", () => {
	test("rejects a non-uuid investigation id", async () => {
		await expect(
			decideEmail(db, config, {
				investigationId: "not-a-uuid",
				decision: "approved",
			}),
		).rejects.toBeInstanceOf(ApprovalError);
	});
});
