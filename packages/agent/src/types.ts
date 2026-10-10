import type { DeclineCode } from "@cube/db";

export type { DeclineCode };

export type CauseSeverity = "soft" | "hard" | "risk";

export type EmailProviderName = "mock" | "resend";

export type AgentConfig = {
	llm: {
		apiKey?: string;
		baseUrl: string;
		model: string;
	};
	email: {
		provider: EmailProviderName;
		apiKey?: string;
		from: string;
	};
	cfo: {
		mcpUrl: string;
		token?: string;
		orgId?: string;
	};
	neatlogs: {
		apiKey?: string;
	};
	/** HMAC secret used to verify mock provider webhooks. */
	mockWebhookSecret: string;
	/** When true, guardrail-passing emails are sent immediately. */
	autoSend: boolean;
};

export type PaymentFailurePayload = {
	id: string;
	provider: string;
	type: "invoice.payment_failed";
	createdAt: string;
	data: {
		projectId: string | null;
		customerExternalId: string;
		customerId: string | null;
		invoiceId: string | null;
		invoiceNumber: string | null;
		amountCents: number;
		currency: string;
		declineCode: DeclineCode;
		declineMessage?: string;
		attemptNumber: number;
		paymentMethod: {
			brand: string;
			last4: string;
			expMonth: number;
			expYear: number;
		};
		customer: {
			name?: string | null;
			email?: string | null;
		};
	};
};
