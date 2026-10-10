export type FailedPaymentInput = {
	/** The tenant's own customer id (unique within the project). */
	customerExternalId: string;
	customer?: { name?: string | null; email?: string | null };
	invoiceNumber?: string | null;
	amountCents: number;
	currency?: string;
	declineCode: string;
	attemptNumber?: number;
	provider?: string;
	occurredAt?: string;
	paymentMethod?: {
		brand?: string;
		last4?: string;
		expMonth?: number;
		expYear?: number;
	};
	/** Defaults to true: create the customer under the project if unknown. */
	createCustomerIfMissing?: boolean;
};

export type IngestResult = {
	eventId: string;
	investigationId: string;
	duplicate: boolean;
};

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

export type InvestigationListPage = {
	investigations: InvestigationListItem[];
	total: number;
	page: number;
	pageSize: number;
};

export type InvestigationQuery = {
	q?: string;
	status?: string;
	severity?: string;
	sort?: "createdAt" | "amount" | "confidence";
	order?: "asc" | "desc";
	page?: number;
	pageSize?: number;
};

export type DecisionOutcome = {
	investigationId: string;
	decision: "approved" | "rejected";
	emailStatus: "queued" | "sent" | "blocked" | "failed";
};
