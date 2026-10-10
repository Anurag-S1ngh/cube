import { randomUUID } from "node:crypto";

import type { AgentConfig } from "../types";

export type EmailTemplateVars = {
	customerName: string;
	amountFormatted: string;
	invoiceNumber: string;
	updateLink: string;
};

type RenderedEmail = { subject: string; body: string };

const templates: Record<string, (vars: EmailTemplateVars) => RenderedEmail> = {
	"reminder.insufficient_funds": (v) => ({
		subject: `Action needed: payment for invoice ${v.invoiceNumber} failed`,
		body: `Hi ${v.customerName},

We couldn't process your payment of ${v.amountFormatted} for invoice ${v.invoiceNumber} because the account had insufficient funds.

No action is strictly required — we'll try again shortly. To settle it now, update your payment details here:
${v.updateLink}

Thanks,
Billing`,
	}),
	"reminder.expired_card": (v) => ({
		subject: `Your card has expired — invoice ${v.invoiceNumber}`,
		body: `Hi ${v.customerName},

Your saved card expired, so we couldn't charge ${v.amountFormatted} for invoice ${v.invoiceNumber}.

Please add a new card to keep your subscription active:
${v.updateLink}

Thanks,
Billing`,
	}),
	"reminder.authentication_required": (v) => ({
		subject: "One quick step to confirm your payment",
		body: `Hi ${v.customerName},

Your bank needs you to authenticate the payment of ${v.amountFormatted} for invoice ${v.invoiceNumber}.

Complete authentication here and we'll finish the charge:
${v.updateLink}

Thanks,
Billing`,
	}),
	"reminder.do_not_honor": (v) => ({
		subject: `Payment for invoice ${v.invoiceNumber} was declined`,
		body: `Hi ${v.customerName},

Your bank declined the payment of ${v.amountFormatted} for invoice ${v.invoiceNumber}. This is often temporary.

You can retry or update your method here:
${v.updateLink}

If it keeps failing, a quick call to your bank usually resolves it.

Thanks,
Billing`,
	}),
	"reminder.invalid_account": (v) => ({
		subject: `Update your payment method for invoice ${v.invoiceNumber}`,
		body: `Hi ${v.customerName},

We couldn't process ${v.amountFormatted} for invoice ${v.invoiceNumber} because the payment details are no longer valid.

Please add a new payment method here:
${v.updateLink}

Thanks,
Billing`,
	}),
	"reminder.lost_card": (v) => ({
		subject: "Please add a replacement payment method",
		body: `Hi ${v.customerName},

The card on file was reported lost, so we couldn't charge ${v.amountFormatted} for invoice ${v.invoiceNumber}.

Add a replacement card here to continue:
${v.updateLink}

Thanks,
Billing`,
	}),
	"reminder.card_not_supported": (v) => ({
		subject: `Alternative payment options for invoice ${v.invoiceNumber}`,
		body: `Hi ${v.customerName},

Your card couldn't be charged ${v.amountFormatted} for invoice ${v.invoiceNumber}. We support other methods (ACH, alternative cards).

Choose an option here:
${v.updateLink}

Thanks,
Billing`,
	}),
	"reminder.generic_decline": (v) => ({
		subject: `We couldn't process your payment for invoice ${v.invoiceNumber}`,
		body: `Hi ${v.customerName},

We couldn't charge ${v.amountFormatted} for invoice ${v.invoiceNumber}. We'll retry automatically, but you can pay now here:
${v.updateLink}

Thanks,
Billing`,
	}),
};

export function renderEmail(
	templateId: string | undefined,
	vars: EmailTemplateVars,
): RenderedEmail {
	const template =
		(templateId && templates[templateId]) ||
		templates["reminder.generic_decline"];
	if (!template) {
		throw new Error(`unknown email template: ${templateId}`);
	}
	return template(vars);
}

export type SendResult = {
	provider: string;
	providerMessageId: string;
};

/**
 * Send an email through the configured provider. The default "mock" provider
 * records the send without calling a third party, which keeps the demo and
 * tests hermetic.
 */
export async function sendEmail(
	config: AgentConfig,
	message: { to: string; subject: string; body: string },
): Promise<SendResult> {
	if (config.email.provider === "resend") {
		if (!config.email.apiKey) {
			throw new Error("EMAIL_API_KEY is required for the resend provider");
		}
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				authorization: `Bearer ${config.email.apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from: config.email.from,
				to: message.to,
				subject: message.subject,
				text: message.body,
			}),
		});
		if (!response.ok) {
			throw new Error(`resend send failed: HTTP ${response.status}`);
		}
		const data = (await response.json()) as { id?: string };
		return {
			provider: "resend",
			providerMessageId: data.id ?? `resend_${randomUUID()}`,
		};
	}

	return {
		provider: "mock",
		providerMessageId: `mock_${randomUUID()}`,
	};
}
