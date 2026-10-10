import type { Database } from "@cube/db";
import {
	approvals,
	auditLog,
	customers,
	emailActions,
	investigations,
} from "@cube/db";
import { and, desc, eq } from "drizzle-orm";

import { logStep, withSpan } from "./observability";
import { sendEmail } from "./tools/email";
import type { AgentConfig } from "./types";
import { emitWebhookEvent } from "./webhooks";

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for a decision the caller got wrong (maps to HTTP 400/404). */
export class ApprovalError extends Error {}

export type ApprovalOutcome = {
	investigationId: string;
	decision: "approved" | "rejected";
	emailStatus: (typeof emailActions.$inferSelect)["status"];
	provider?: string;
	providerMessageId?: string;
};

/**
 * Resolve a queued (guardrail-passed, awaiting human review) email. Approving
 * sends it through the configured provider; rejecting records the block. Both
 * outcomes are audited and stored in `approvals`.
 */
export async function decideEmail(
	db: Database,
	config: AgentConfig,
	input: {
		investigationId: string;
		decision: "approved" | "rejected";
		actor?: string;
		reason?: string;
	},
): Promise<ApprovalOutcome> {
	const { investigationId, decision } = input;
	if (!uuidPattern.test(investigationId)) {
		throw new ApprovalError("invalid investigation id");
	}

	const [pending] = await db
		.select()
		.from(emailActions)
		.where(
			and(
				eq(emailActions.investigationId, investigationId),
				eq(emailActions.status, "queued"),
			),
		)
		.orderBy(desc(emailActions.createdAt))
		.limit(1);

	if (!pending) {
		throw new ApprovalError("no email is awaiting approval");
	}

	const [scope] = await db
		.select({ projectId: customers.projectId })
		.from(investigations)
		.innerJoin(customers, eq(customers.id, investigations.customerId))
		.where(eq(investigations.id, investigationId))
		.limit(1);
	const projectId = scope?.projectId;

	const actor = input.actor?.trim() || "operator";

	if (decision === "rejected") {
		const reason = input.reason?.trim() || "rejected by operator";
		await db
			.update(emailActions)
			.set({ status: "blocked", blockReason: reason })
			.where(eq(emailActions.id, pending.id));
		await db.insert(approvals).values({
			investigationId,
			actor,
			decision: "rejected",
			reason,
			metadata: { templateId: pending.templateId, to: pending.to },
		});
		await recordAudit(db, investigationId, "email_rejected", {
			actor,
			reason,
			templateId: pending.templateId,
		});
		logStep("email_rejected", { actor, reason });
		if (projectId) {
			await emitWebhookEvent(db, {
				projectId,
				event: "email.blocked",
				investigationId,
				data: { reason, templateId: pending.templateId },
			});
		}
		return {
			investigationId,
			decision: "rejected",
			emailStatus: "blocked",
		};
	}

	let send: Awaited<ReturnType<typeof sendEmail>>;
	try {
		send = await withSpan(
			"email.send",
			"TOOL",
			{ templateId: pending.templateId, provider: config.email.provider },
			() =>
				sendEmail(config, {
					to: pending.to,
					subject: pending.subject,
					body: pending.body,
				}),
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		await db
			.update(emailActions)
			.set({ status: "failed", blockReason: reason })
			.where(eq(emailActions.id, pending.id));
		await recordAudit(db, investigationId, "email_failed", { reason });
		logStep("email_failed", { reason });
		throw new ApprovalError(`email send failed: ${reason}`);
	}

	await db
		.update(emailActions)
		.set({
			status: "sent",
			provider: send.provider,
			providerMessageId: send.providerMessageId,
			sentAt: new Date(),
			blockReason: null,
		})
		.where(eq(emailActions.id, pending.id));
	await db.insert(approvals).values({
		investigationId,
		actor,
		decision: "approved",
		reason: input.reason?.trim() || null,
		metadata: { templateId: pending.templateId, to: pending.to },
	});
	await db
		.update(investigations)
		.set({ status: "actioned", updatedAt: new Date() })
		.where(eq(investigations.id, investigationId));
	await recordAudit(db, investigationId, "email_approved", {
		actor,
		templateId: pending.templateId,
		provider: send.provider,
		providerMessageId: send.providerMessageId,
	});
	logStep("email_approved", {
		actor,
		templateId: pending.templateId,
		provider: send.provider,
	});
	if (projectId) {
		await emitWebhookEvent(db, {
			projectId,
			event: "email.sent",
			investigationId,
			data: {
				templateId: pending.templateId,
				provider: send.provider,
				providerMessageId: send.providerMessageId,
			},
		});
		await emitWebhookEvent(db, {
			projectId,
			event: "investigation.actioned",
			investigationId,
			data: { actions: ["email_reminder"] },
		});
	}

	return {
		investigationId,
		decision: "approved",
		emailStatus: "sent",
		provider: send.provider,
		providerMessageId: send.providerMessageId,
	};
}

async function recordAudit(
	db: Database,
	investigationId: string,
	action: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await db.insert(auditLog).values({
		entity: "investigation",
		entityId: investigationId,
		action,
		actor: "operator",
		payload,
	});
}
