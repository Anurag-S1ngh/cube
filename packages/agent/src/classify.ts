import type { InvestigationContext } from "./context";
import { causeTemplates } from "./taxonomy";
import type { CauseSeverity } from "./types";

export type Classification = {
	code: string;
	label: string;
	severity: CauseSeverity;
	confidence: number;
	evidence: Record<string, unknown>;
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic, auditable classification. Maps the provider decline code to a
 * probable cause and adjusts confidence using the customer's history. Every
 * figure and signal used is captured in `evidence`.
 */
export function classify(ctx: InvestigationContext): Classification {
	const template = causeTemplates[ctx.event.declineCode];
	let confidence = template.confidence;

	// Repeated failures erode the assumption that a plain retry will recover a
	// soft decline.
	if (template.severity === "soft" && ctx.priorFailureCount >= 3) {
		confidence -= 15;
	}
	// A long-overdue invoice on a soft decline may point at a deeper issue.
	if (template.severity === "soft" && ctx.overdueDays > 30) {
		confidence -= 5;
	}
	// Good payers are more likely to be a transient issue.
	if (
		template.severity === "soft" &&
		ctx.paymentHistory.paid > 0 &&
		ctx.paymentHistory.unpaid === 0
	) {
		confidence += 3;
	}

	return {
		code: template.code,
		label: template.label,
		severity: template.severity,
		confidence: clamp(Math.round(confidence), 30, 99),
		evidence: {
			declineCode: ctx.event.declineCode,
			attemptNumber: ctx.event.attemptNumber,
			priorFailureCount: ctx.priorFailureCount,
			overdueDays: ctx.overdueDays,
			invoiceNumber: ctx.event.invoiceNumber,
			amountCents: ctx.event.amountCents,
			paymentHistory: ctx.paymentHistory,
		},
	};
}
