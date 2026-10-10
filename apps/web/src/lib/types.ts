export type InvestigationListItem = {
	id: string;
	status: string;
	createdAt: string;
	customerName: string | null;
	customerEmail: string | null;
	amountCents: number;
	currency: string;
	declineCode: string;
	causeCode: string | null;
	confidence: number | null;
	severity: "soft" | "hard" | "risk" | null;
	revenueAtRiskCents: number | null;
	neatlogsTraceId: string | null;
	cfoScenarioRef: string | null;
};

export type InvestigationPage = {
	investigations: InvestigationListItem[];
	total: number;
	page: number;
	pageSize: number;
};

export type Summary = {
	total: number;
	byStatus: Record<string, number>;
	revenueAtRiskCents: number;
	emailsSent: number;
	emailsBlocked: number;
	emailsQueued: number;
};

export type EmailAction = {
	id: string;
	templateId: string;
	to: string;
	subject: string;
	body: string;
	status: string;
	provider: string;
	providerMessageId: string | null;
	blockReason: string | null;
	sentAt: string | null;
};

export type InvestigationDetail = {
	investigation: {
		id: string;
		status: string;
		outstandingBalanceCents: number | null;
		revenueAtRiskCents: number | null;
		cfoScenarioRef: string | null;
		cfoEvidence: Record<string, unknown> | null;
		neatlogsTraceId: string | null;
		error: string | null;
		createdAt: string;
	};
	customer: {
		id: string;
		name: string | null;
		email: string | null;
		externalId: string;
	};
	event: {
		amountCents: number;
		currency: string;
		declineCode: string;
		invoiceNumber: string | null;
		attemptNumber: number;
		raw: Record<string, unknown>;
	};
	cause: {
		code: string;
		label: string;
		severity: string;
		confidence: number;
		evidence: Record<string, unknown>;
	} | null;
	recommendation: {
		summary: string;
		rationale: string;
		actions: { type: string; description: string; schedule?: string }[];
		cashImpactCents: number;
	} | null;
	scenarios: {
		id: string;
		cfoRef: string;
		kind: string;
		projectedInflowCents: number;
	}[];
	emails: EmailAction[];
	timeline: {
		id: string;
		action: string;
		actor: string;
		payload: Record<string, unknown>;
		at: string;
	}[];
	runs: {
		id: string;
		latencyMs: number;
		model: string | null;
		tokensIn: number;
		tokensOut: number;
		neatlogsTraceId: string | null;
	}[];
};

export function formatMoney(cents: number | null, currency = "usd"): string {
	if (cents == null) return "—";
	const symbols: Record<string, string> = {
		usd: "$",
		eur: "€",
		gbp: "£",
		inr: "₹",
		jpy: "¥",
	};
	const symbol = symbols[currency.toLowerCase()] ?? "";
	const amount = (cents / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return symbol ? `${symbol}${amount}` : `${amount} ${currency.toUpperCase()}`;
}
