import { randomUUID } from "node:crypto";

import type { AgentConfig } from "./types";

type NeatlogsModule = typeof import("neatlogs");

type SpanKind =
	| "WORKFLOW"
	| "AGENT"
	| "CHAIN"
	| "TOOL"
	| "GUARDRAIL"
	| "MCP_TOOL"
	| "LLM"
	| "RETRIEVER";

let sdk: NeatlogsModule | null = null;
let enabled = false;

/**
 * Initialize neatlogs once at the process entry point. When no API key is set
 * we stay in "local" mode: trace ids are generated so the dashboard can still
 * link to an investigation, but no spans leave the machine.
 */
export async function initObservability(config: AgentConfig): Promise<boolean> {
	if (!config.neatlogs.apiKey) return false;
	try {
		const mod = await import("neatlogs");
		await mod.init({
			apiKey: config.neatlogs.apiKey,
			workflowName: "payment-failure-agent",
			captureLogs: true,
		});
		sdk = mod;
		enabled = true;
		return true;
	} catch (error) {
		console.warn("[observability] neatlogs init failed", error);
		return false;
	}
}

export function isObservabilityEnabled(): boolean {
	return enabled;
}

function generateTraceId(): string {
	return randomUUID().replace(/-/g, "");
}

/**
 * Root span for one agent run. Returns the trace id so it can be persisted
 * against the investigation (and deep-linked from the dashboard).
 */
export async function withWorkflow<T>(
	name: string,
	attributes: Record<string, unknown>,
	fn: (traceId: string) => Promise<T>,
): Promise<T> {
	if (!sdk) return fn(generateTraceId());
	try {
		return await sdk.trace(
			{ name, kind: "WORKFLOW", attributes },
			async (span) => fn(span.spanContext().traceId),
		);
	} catch (error) {
		console.warn("[observability] workflow span failed", error);
		return fn(generateTraceId());
	}
}

/** A nested step span (tool call, agent step, guardrail, ...). */
export async function withSpan<T>(
	name: string,
	kind: SpanKind,
	attributes: Record<string, unknown>,
	fn: () => Promise<T>,
): Promise<T> {
	if (!sdk) return fn();
	try {
		return await sdk.trace({ name, kind, attributes }, async () => fn());
	} catch (error) {
		console.warn(`[observability] span ${name} failed`, error);
		return fn();
	}
}

/**
 * Emit a structured log step inside the active trace. These become LOG spans
 * that neatlogs detections can match on (e.g. "email_blocked", low confidence).
 */
export function logStep(message: string, data?: Record<string, unknown>): void {
	if (!sdk) return;
	try {
		sdk.log(message, data);
	} catch {
		// logging is best-effort
	}
}

export async function flushObservability(): Promise<void> {
	if (!sdk) return;
	try {
		await sdk.flush();
	} catch {
		// ignore
	}
}
