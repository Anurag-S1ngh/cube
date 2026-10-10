import type { DeclineCode } from "@cube/db";

import type { CauseSeverity } from "./types";

export type CauseTemplate = {
	code: string;
	label: string;
	severity: CauseSeverity;
	description: string;
	/** Base confidence for the deterministic classifier (0-100). */
	confidence: number;
};

export const causeTemplates: Record<DeclineCode, CauseTemplate> = {
	insufficient_funds: {
		code: "insufficient_funds",
		label: "Insufficient funds",
		severity: "soft",
		description:
			"The customer's account did not have enough funds. Usually resolves on a later retry.",
		confidence: 95,
	},
	expired_card: {
		code: "expired_card",
		label: "Expired card",
		severity: "hard",
		description:
			"The saved card has expired. The customer must provide updated card details.",
		confidence: 98,
	},
	authentication_required: {
		code: "authentication_required",
		label: "Authentication required (SCA/3DS)",
		severity: "hard",
		description:
			"The issuer requires strong customer authentication before the charge can complete.",
		confidence: 90,
	},
	do_not_honor: {
		code: "do_not_honor",
		label: "Declined by issuer (do not honor)",
		severity: "soft",
		description:
			"A generic issuer decline. Often temporary; a retry and contacting the issuer can help.",
		confidence: 70,
	},
	processing_error: {
		code: "processing_error",
		label: "Processing error",
		severity: "soft",
		description:
			"A transient network or processor error. Safe to retry automatically.",
		confidence: 85,
	},
	invalid_account: {
		code: "invalid_account",
		label: "Invalid account details",
		severity: "hard",
		description: "The payment method details are invalid or no longer usable.",
		confidence: 92,
	},
	fraudulent: {
		code: "fraudulent",
		label: "Flagged as fraudulent",
		severity: "risk",
		description:
			"The issuer or processor flagged the charge as fraudulent. Do not retry; escalate to risk.",
		confidence: 88,
	},
	stolen_card: {
		code: "stolen_card",
		label: "Reported stolen card",
		severity: "risk",
		description:
			"The card was reported stolen. Do not retry; escalate to risk and halt outreach.",
		confidence: 92,
	},
	lost_card: {
		code: "lost_card",
		label: "Reported lost card",
		severity: "risk",
		description:
			"The card was reported lost. Do not retry; request a new payment method.",
		confidence: 90,
	},
	card_not_supported: {
		code: "card_not_supported",
		label: "Card not supported",
		severity: "hard",
		description:
			"The card type or region is not supported. The customer needs an alternative method.",
		confidence: 85,
	},
	generic_decline: {
		code: "generic_decline",
		label: "Generic decline",
		severity: "soft",
		description:
			"An unclassified decline. Retry on a standard schedule and prompt the customer.",
		confidence: 60,
	},
};

export type MitigationPlan = {
	summary: string;
	rationale: string;
	retryScheduleDays: number[];
	sendEmail: boolean;
	actions: {
		type:
			| "retry_schedule"
			| "email_reminder"
			| "card_update_link"
			| "sca_auth_link"
			| "alt_payment_method"
			| "pause_subscription"
			| "risk_escalation";
		description: string;
		schedule?: string;
		templateId?: string;
	}[];
};

/**
 * Deterministic first-pass mitigation per decline code. The LLM layer may
 * enrich the rationale, but the actions themselves stay auditable.
 */
export const mitigationTemplates: Record<DeclineCode, MitigationPlan> = {
	insufficient_funds: {
		summary: "Retry on a gentle schedule and remind the customer.",
		rationale:
			"Insufficient funds are usually temporary, so spaced retries recover most charges with a low-friction reminder.",
		retryScheduleDays: [3, 5, 7],
		sendEmail: true,
		actions: [
			{
				type: "retry_schedule",
				description: "Retry the charge on days 3, 5 and 7.",
				schedule: "3,5,7",
			},
			{
				type: "email_reminder",
				description: "Send a friendly reminder with a secure payment link.",
				templateId: "reminder.insufficient_funds",
			},
		],
	},
	expired_card: {
		summary: "Ask the customer to update their card, then retry.",
		rationale:
			"An expired card cannot be retried successfully; only an updated card will clear the charge.",
		retryScheduleDays: [],
		sendEmail: true,
		actions: [
			{
				type: "email_reminder",
				description: "Send a card-update request with a secure update link.",
				templateId: "reminder.expired_card",
			},
			{
				type: "card_update_link",
				description: "Generate a hosted card-update link for the customer.",
			},
		],
	},
	authentication_required: {
		summary: "Send a 3DS authentication link and retry after completion.",
		rationale:
			"The issuer needs strong customer authentication; the charge will clear once the customer completes it.",
		retryScheduleDays: [1, 3],
		sendEmail: true,
		actions: [
			{
				type: "sca_auth_link",
				description: "Send a link to complete 3DS authentication.",
			},
			{
				type: "email_reminder",
				description: "Email the customer with the authentication link.",
				templateId: "reminder.authentication_required",
			},
		],
	},
	do_not_honor: {
		summary: "Retry once and ask the customer to contact their issuer.",
		rationale:
			"Generic issuer declines often need the customer to authorize the charge or contact their bank.",
		retryScheduleDays: [2, 5],
		sendEmail: true,
		actions: [
			{
				type: "retry_schedule",
				description: "Retry the charge on days 2 and 5.",
				schedule: "2,5",
			},
			{
				type: "email_reminder",
				description: "Ask the customer to contact their issuer.",
				templateId: "reminder.do_not_honor",
			},
		],
	},
	processing_error: {
		summary: "Automatically retry; no customer action needed.",
		rationale:
			"Transient processor errors typically clear without any customer involvement.",
		retryScheduleDays: [1, 2],
		sendEmail: false,
		actions: [
			{
				type: "retry_schedule",
				description: "Silently retry on days 1 and 2.",
				schedule: "1,2",
			},
		],
	},
	invalid_account: {
		summary: "Request updated payment details before retrying.",
		rationale:
			"The stored payment method is invalid, so retries will fail until it is replaced.",
		retryScheduleDays: [],
		sendEmail: true,
		actions: [
			{
				type: "email_reminder",
				description: "Request a new payment method with a secure update link.",
				templateId: "reminder.invalid_account",
			},
		],
	},
	fraudulent: {
		summary: "Halt retries and escalate to the risk team.",
		rationale:
			"Fraudulent flags must not be retried and should not trigger automated customer outreach.",
		retryScheduleDays: [],
		sendEmail: false,
		actions: [
			{
				type: "risk_escalation",
				description: "Escalate the charge to the risk team for manual review.",
			},
		],
	},
	stolen_card: {
		summary: "Halt retries, suppress outreach and escalate to risk.",
		rationale:
			"A stolen-card flag is a hard stop: no retries and no customer emails.",
		retryScheduleDays: [],
		sendEmail: false,
		actions: [
			{
				type: "risk_escalation",
				description: "Escalate to risk and suppress all customer outreach.",
			},
		],
	},
	lost_card: {
		summary: "Suppress retries and request a new payment method.",
		rationale:
			"A lost card cannot be charged; the customer must add a replacement card.",
		retryScheduleDays: [],
		sendEmail: true,
		actions: [
			{
				type: "email_reminder",
				description: "Request a replacement payment method.",
				templateId: "reminder.lost_card",
			},
		],
	},
	card_not_supported: {
		summary: "Offer an alternative payment method.",
		rationale:
			"The card cannot be charged in this configuration, so offer another method to keep the customer.",
		retryScheduleDays: [],
		sendEmail: true,
		actions: [
			{
				type: "alt_payment_method",
				description: "Offer ACH or an alternative card.",
			},
			{
				type: "email_reminder",
				description: "Notify the customer of the alternative options.",
				templateId: "reminder.card_not_supported",
			},
		],
	},
	generic_decline: {
		summary: "Standard retry schedule with a reminder.",
		rationale:
			"Unclassified decline; a standard retry ladder plus a reminder covers the common cases.",
		retryScheduleDays: [3, 7],
		sendEmail: true,
		actions: [
			{
				type: "retry_schedule",
				description: "Retry on days 3 and 7.",
				schedule: "3,7",
			},
			{
				type: "email_reminder",
				description: "Send a standard payment reminder.",
				templateId: "reminder.generic_decline",
			},
		],
	},
};
