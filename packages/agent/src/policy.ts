import type { Database } from "@cube/db";
import { emailActions } from "@cube/db";
import { and, count, eq, gt } from "drizzle-orm";

import type { Classification } from "./classify";
import type { InvestigationContext } from "./context";
import type { AgentConfig } from "./types";

export type PolicyDecision = {
	allowed: boolean;
	reason?: string;
	checks: Record<string, boolean>;
};

const MAX_EMAILS_PER_24H = 3;
const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000
const QUIET_HOURS_START = 21;
const QUIET_HOURS_END = 8;

/**
 * Guardrails that run before any customer email is sent. Even in full
 * auto-send mode every send passes through here, and the outcome is recorded.
 */
export async function evaluateOutreachPolicy(
	db: Database,
	_config: AgentConfig,
	ctx: InvestigationContext,
	classification: Classification,
	now: Date = new Date(),
): Promise<PolicyDecision> {
	const email = ctx.customer.email ?? "";

	const hasEmail = email.length > 0;
	const notRisk = classification.severity !== "risk";
	const amountSane =
		ctx.event.amountCents > 0 && ctx.event.amountCents <= MAX_AMOUNT_CENTS;

	const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const [recent] = await db
		.select({ value: count() })
		.from(emailActions)
		.where(
			and(
				eq(emailActions.to, email),
				eq(emailActions.status, "sent"),
				gt(emailActions.createdAt, since),
			),
		);
	const underRateLimit = Number(recent?.value ?? 0) < MAX_EMAILS_PER_24H;

	const hour = now.getHours();
	const outsideQuietHours = hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START;

	const checks = {
		hasEmail,
		notRisk,
		amountSane,
		underRateLimit,
		outsideQuietHours,
	};

	let reason: string | undefined;
	if (!hasEmail) reason = "customer has no email address";
	else if (!notRisk) reason = "risk-flagged charge: outreach suppressed";
	else if (!amountSane) reason = "amount outside the allowed range";
	else if (!underRateLimit)
		reason = `rate limit: ${MAX_EMAILS_PER_24H} emails sent in 24h`;
	else if (!outsideQuietHours) reason = "quiet hours (9pm-8am)";

	return { allowed: !reason, reason, checks };
}
