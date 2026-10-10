import type { RecommendedAction } from "@cube/db";
import type { Classification } from "./classify";
import type { InvestigationContext } from "./context";
import { mitigationTemplates } from "./taxonomy";

export type RecommendationResult = {
	summary: string;
	rationale: string;
	actions: RecommendedAction[];
	retryScheduleDays: number[];
	cashImpactCents: number;
};

/**
 * Deterministic mitigation. Starts from the per-decline playbook, then applies
 * history-aware overrides (repeated failures, risk flags, long delinquency).
 * The recommended actions are auditable; the rationale can be enriched later.
 */
export function recommend(
	ctx: InvestigationContext,
	classification: Classification,
	rationaleOverride?: string,
): RecommendationResult {
	const plan = mitigationTemplates[ctx.event.declineCode];

	let summary = plan.summary;
	let actions: RecommendedAction[] = plan.actions.map((a) => ({ ...a }));
	let retryScheduleDays = [...plan.retryScheduleDays];

	if (classification.severity === "risk") {
		// Hard stop: never retry or email a flagged charge.
		summary = mitigationTemplates[ctx.event.declineCode].summary;
		actions = actions.filter((a) => a.type === "risk_escalation");
		retryScheduleDays = [];
	} else if (ctx.priorFailureCount >= 3 && retryScheduleDays.length > 0) {
		// The retry ladder already failed three times; stop retrying and switch
		// the customer to an alternative payment method.
		retryScheduleDays = [];
		actions = [
			...actions.filter((a) => a.type !== "retry_schedule"),
			{
				type: "alt_payment_method",
				description:
					"Repeated retries failed; offer an alternative payment method.",
			},
		];
		summary = "Repeated failures — switch to an alternative payment method.";
	}

	const rationale =
		rationaleOverride ??
		`${classification.label} detected with ${classification.confidence}% confidence. ${plan.rationale}`;

	return {
		summary,
		rationale,
		actions,
		retryScheduleDays,
		cashImpactCents: ctx.event.amountCents,
	};
}
