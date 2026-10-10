/**
 * Minimal Model Context Protocol client over the Streamable HTTP transport.
 * cfo.ai exposes its workspace tools at https://api.cfo.ai/mcp using JSON-RPC
 * 2.0. This client speaks just enough of the protocol (initialize + tools/call)
 * for the agent to read financial context and write scenarios.
 */
export type McpTool = {
	name: string;
	description?: string;
	inputSchema?: unknown;
};

type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

export type McpClientOptions = {
	url: string;
	token?: string;
	orgId?: string;
	timeoutMs?: number;
};

function parseSse(body: string): unknown {
	// Streamable HTTP may return text/event-stream; take the first data frame.
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("data:")) {
			const payload = trimmed.slice("data:".length).trim();
			if (payload.length > 0) {
				try {
					return JSON.parse(payload);
				} catch {
					// keep scanning
				}
			}
		}
	}
	return null;
}

export class McpClient {
	private readonly url: string;
	private readonly token?: string;
	private readonly orgId?: string;
	private readonly timeoutMs: number;
	private sessionId?: string;
	private nextId = 1;
	private initialized = false;

	constructor(options: McpClientOptions) {
		this.url = options.url;
		this.token = options.token;
		this.orgId = options.orgId;
		this.timeoutMs = options.timeoutMs ?? 15_000;
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		};
		if (this.token) headers.authorization = `Bearer ${this.token}`;
		if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
		return headers;
	}

	private async rpc(method: string, params: unknown): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const response = await fetch(this.url, {
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: this.nextId++,
					method,
					params,
				}),
				signal: controller.signal,
			});

			const session = response.headers.get("mcp-session-id");
			if (session) this.sessionId = session;

			if (!response.ok) {
				throw new Error(`MCP ${method} failed: HTTP ${response.status}`);
			}

			const contentType = response.headers.get("content-type") ?? "";
			const text = await response.text();
			const payload = contentType.includes("text/event-stream")
				? parseSse(text)
				: (JSON.parse(text) as JsonRpcResponse);

			if (!payload || typeof payload !== "object") {
				return null;
			}
			const rpc = payload as JsonRpcResponse;
			if (rpc.error) {
				throw new Error(`MCP ${method} error: ${rpc.error.message}`);
			}
			return rpc.result;
		} finally {
			clearTimeout(timer);
		}
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		await this.rpc("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "cube-payment-agent", version: "0.1.0" },
		});
		this.initialized = true;
	}

	async listTools(): Promise<McpTool[]> {
		await this.initialize();
		const result = (await this.rpc("tools/list", {})) as {
			tools?: McpTool[];
		} | null;
		return result?.tools ?? [];
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		await this.initialize();
		const params: Record<string, unknown> = { name, arguments: args };
		if (this.orgId) params._meta = { org_id: this.orgId };
		const result = (await this.rpc("tools/call", params)) as {
			content?: { type: string; text?: string }[];
			isError?: boolean;
		} | null;

		if (result?.isError) {
			throw new Error(`MCP tool ${name} returned an error`);
		}
		const textPart = result?.content?.find((c) => c.type === "text")?.text;
		if (!textPart) return result;
		try {
			return JSON.parse(textPart);
		} catch {
			return textPart;
		}
	}

	isConfigured(): boolean {
		return Boolean(this.token);
	}
}
