import type { AgentConfig } from "@cube/agent";

import { ENV } from "./env.server";

const resendKey = ENV.RESEND_API_KEY || undefined;
// The Resend provider needs an API key; without one, fall back to mock so the
// pipeline keeps working locally.
const emailProvider =
	ENV.EMAIL_PROVIDER === "resend" && !resendKey ? "mock" : ENV.EMAIL_PROVIDER;

export const agentConfig: AgentConfig = {
	llm: {
		apiKey: ENV.LLM_API_KEY || undefined,
		baseUrl: ENV.LLM_BASE_URL ?? "https://api.openai.com/v1",
		model: ENV.LLM_MODEL ?? "gpt-4o-mini",
	},
	email: {
		provider: emailProvider,
		apiKey: resendKey,
		from: ENV.EMAIL_FROM ?? "onboarding@resend.dev",
		overrideTo: ENV.EMAIL_OVERRIDE_TO || undefined,
	},
	cfo: {
		mcpUrl: ENV.CFO_AI_MCP_URL,
		token: ENV.CFO_AI_TOKEN || undefined,
		orgId: ENV.CFO_AI_ORG_ID || undefined,
		oauth: {
			credentialsPath:
				ENV.CFO_AI_CREDENTIALS_PATH || ".cfo-ai/credentials.json",
		},
	},
	neatlogs: {
		apiKey: ENV.NEATLOGS_API_KEY || undefined,
	},
	mockWebhookSecret: ENV.MOCK_WEBHOOK_SECRET,
	autoSend: ENV.AGENT_AUTO_SEND,
};
