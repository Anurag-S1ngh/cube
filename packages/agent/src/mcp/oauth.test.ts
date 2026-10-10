import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAccessToken, loadTokens, saveTokens } from "./oauth";

async function tempPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "cfo-oauth-"));
	return join(dir, "credentials.json");
}

describe("oauth token store", () => {
	test("round-trips tokens", async () => {
		const path = await tempPath();
		await saveTokens(path, {
			access_token: "abc",
			refresh_token: "r1",
			expires_at: Date.now() + 3_600_000,
			token_endpoint: "https://auth.example/token",
			client_id: "client1",
		});
		const loaded = await loadTokens(path);
		expect(loaded?.access_token).toBe("abc");
		await rm(path, { force: true });
	});

	test("returns null when no credentials exist", async () => {
		const path = await tempPath();
		const token = await getAccessToken({
			mcpUrl: "https://api.cfo.ai/mcp",
			credentialsPath: path,
		});
		expect(token).toBeNull();
		await rm(path, { force: true });
	});

	test("returns the stored token when not expired", async () => {
		const path = await tempPath();
		await saveTokens(path, {
			access_token: "valid",
			expires_at: Date.now() + 3_600_000,
			token_endpoint: "https://auth.example/token",
			client_id: "client1",
		});
		const token = await getAccessToken({
			mcpUrl: "https://api.cfo.ai/mcp",
			credentialsPath: path,
		});
		expect(token).toBe("valid");
		await rm(path, { force: true });
	});

	test("refreshes an expired token and persists the new one", async () => {
		const path = await tempPath();
		await saveTokens(path, {
			access_token: "old",
			refresh_token: "r1",
			expires_at: Date.now() - 1000,
			token_endpoint: "https://auth.example/token",
			client_id: "client1",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					access_token: "new",
					refresh_token: "r2",
					expires_in: 3600,
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;

		try {
			const token = await getAccessToken({
				mcpUrl: "https://api.cfo.ai/mcp",
				credentialsPath: path,
			});
			expect(token).toBe("new");
			const stored = await loadTokens(path);
			expect(stored?.access_token).toBe("new");
			expect(stored?.refresh_token).toBe("r2");
		} finally {
			globalThis.fetch = originalFetch;
			await rm(path, { force: true });
		}
	});
});
