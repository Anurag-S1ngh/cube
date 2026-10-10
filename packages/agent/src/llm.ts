import type { AgentConfig } from "./types";

export type LlmRationale = {
	rationale: string;
	tokensIn: number;
	tokensOut: number;
	model: string;
};

type EnrichInput = {
	customer: string;
	declineCode: string;
	causeLabel: string;
	severity: string;
	confidence: number;
	amountFormatted: string;
	actions: string[];
	retryScheduleDays: number[];
};

type ChatCompletionResponse = {
	choices?: { message?: { content?: string } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	model?: string;
};

/**
 * Enrich a deterministic recommendation with a short, human rationale from the
 * LLM. Uses any OpenAI-compatible endpoint (Gemini's OpenAI shim by default).
 * Returns null on any failure so the pipeline always falls back to the
 * deterministic rationale.
 */
export async function enrichRationale(
	config: AgentConfig,
	input: EnrichInput,
): Promise<LlmRationale | null> {
	if (!config.llm.apiKey) return null;
	const base = config.llm.baseUrl.replace(/\/+$/, "");

	try {
		const response = await fetch(`${base}/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${config.llm.apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: config.llm.model,
				temperature: 0.2,
				response_format: { type: "json_object" },
				messages: [
					{
						role: "system",
						content:
							'You are a billing-operations assistant. Given a failed payment and a proposed recovery plan, write ONE concise sentence (max 30 words) explaining the likely cause and why the plan is appropriate for this customer. Respond as JSON: {"rationale": string}.',
					},
					{ role: "user", content: JSON.stringify(input) },
				],
			}),
			signal: AbortSignal.timeout(15_000),
		});

		if (!response.ok) return null;

		const data = (await response.json()) as ChatCompletionResponse;
		const content = data.choices?.[0]?.message?.content;
		if (!content) return null;

		const parsed = JSON.parse(content) as { rationale?: string };
		const rationale = parsed.rationale?.trim();
		if (!rationale) return null;

		return {
			rationale,
			tokensIn: data.usage?.prompt_tokens ?? 0,
			tokensOut: data.usage?.completion_tokens ?? 0,
			model: data.model ?? config.llm.model,
		};
	} catch {
		return null;
	}
}
