import { ENV } from "@/env";

/**
 * Substitute the {id} placeholder in a configured deep-link template. When the
 * template has no {id}, the base URL is returned as-is.
 */
function build(template: string, id: string | null | undefined): string | null {
	if (!id) return null;
	return template.includes("{id}")
		? template.replace("{id}", encodeURIComponent(id))
		: template;
}

export function neatlogsTraceUrl(id: string | null): string | null {
	return build(ENV.NEXT_PUBLIC_NEATLOGS_TRACE_URL, id);
}

export function cfoScenarioUrl(ref: string | null): string | null {
	if (!ref || ref.startsWith("local:")) return null;
	return build(ENV.NEXT_PUBLIC_CFO_AI_SCENARIO_URL, ref);
}

export function entireCheckpointUrl(id: string | null): string | null {
	return build(ENV.NEXT_PUBLIC_ENTIRE_CHECKPOINT_URL, id);
}
