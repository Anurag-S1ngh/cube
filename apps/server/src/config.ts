import type { AgentConfig } from "@cube/agent";

import { ENV } from "./env.server";

export const agentConfig: AgentConfig = {
	llm: {
		apiKey: ENV.LLM_API_KEY || undefined,
		baseUrl: ENV.LLM_BASE_URL ?? "https://api.openai.com/v1",
		model: ENV.LLM_MODEL ?? "gpt-4o-mini",
	},
	email: {
		provider: ENV.EMAIL_PROVIDER,
		apiKey: ENV.EMAIL_API_KEY || undefined,
		from: ENV.EMAIL_FROM ?? "payments@example.com",
	},
	cfo: {
		mcpUrl: ENV.CFO_AI_MCP_URL,
		token: ENV.CFO_AI_TOKEN || undefined,
		orgId: ENV.CFO_AI_ORG_ID || undefined,
	},
	neatlogs: {
		apiKey: ENV.NEATLOGS_API_KEY || undefined,
	},
	mockWebhookSecret: ENV.MOCK_WEBHOOK_SECRET,
	autoSend: ENV.AGENT_AUTO_SEND,
};
