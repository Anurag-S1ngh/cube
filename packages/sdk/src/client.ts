import { CubeError } from "./errors";
import type {
	DecisionOutcome,
	FailedPaymentInput,
	IngestResult,
	InvestigationListPage,
	InvestigationQuery,
} from "./types";

export type CubeOptions = {
	/** Project API key (`cube_…`). */
	apiKey: string;
	/** API base URL. Defaults to `http://localhost:3000`. */
	baseUrl?: string;
	/** Override the fetch implementation (tests, custom agents). */
	fetch?: typeof fetch;
	/** Retries for network errors, 429 and 5xx. Default 2. */
	maxRetries?: number;
	/** Per-request timeout in ms. Default 30000. */
	timeoutMs?: number;
};

type Query = Record<string, string | number | undefined>;

type RequestInput = {
	method: "GET" | "POST" | "DELETE";
	path: string;
	body?: unknown;
	query?: Query;
	idempotencyKey?: string;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
	return Math.min(2 ** attempt * 200 + Math.random() * 100, 5000);
}

/**
 * Typed client for the Cube API. Authenticates with a project API key and
 * retries transient failures with backoff. Every request carries an
 * idempotency key so retries never double-ingest.
 */
export class Cube {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;
	private readonly maxRetries: number;
	private readonly timeoutMs: number;

	readonly events: {
		failedPayment: (
			input: FailedPaymentInput,
			options?: { idempotencyKey?: string },
		) => Promise<IngestResult>;
	};

	readonly investigations: {
		list: (query?: InvestigationQuery) => Promise<InvestigationListPage>;
		get: (id: string) => Promise<unknown>;
		approve: (id: string) => Promise<DecisionOutcome>;
		reject: (id: string, reason?: string) => Promise<DecisionOutcome>;
	};

	constructor(options: CubeOptions) {
		if (!options.apiKey) throw new Error("Cube: an apiKey is required");
		this.apiKey = options.apiKey;
		this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(
			/\/$/,
			"",
		);
		this.fetchImpl = options.fetch ?? fetch;
		this.maxRetries = options.maxRetries ?? 2;
		this.timeoutMs = options.timeoutMs ?? 30_000;

		this.events = {
			failedPayment: (input, opts) =>
				this.request<IngestResult>({
					method: "POST",
					path: "/events/failed-payment",
					body: input,
					idempotencyKey: opts?.idempotencyKey,
				}),
		};

		this.investigations = {
			list: (query) =>
				this.request<InvestigationListPage>({
					method: "GET",
					path: "/investigations",
					query: query as Query | undefined,
				}),
			get: (id) =>
				this.request<unknown>({
					method: "GET",
					path: `/investigations/${encodeURIComponent(id)}`,
				}),
			approve: (id) =>
				this.request<DecisionOutcome>({
					method: "POST",
					path: `/investigations/${encodeURIComponent(id)}/approve`,
				}),
			reject: (id, reason) =>
				this.request<DecisionOutcome>({
					method: "POST",
					path: `/investigations/${encodeURIComponent(id)}/reject`,
					body: reason ? { reason } : {},
				}),
		};
	}

	private async request<T>(input: RequestInput): Promise<T> {
		const url = new URL(this.baseUrl + input.path);
		if (input.query) {
			for (const [key, value] of Object.entries(input.query)) {
				if (value !== undefined && value !== "") {
					url.searchParams.set(key, String(value));
				}
			}
		}

		const headers: Record<string, string> = {
			authorization: `Bearer ${this.apiKey}`,
			accept: "application/json",
		};
		if (input.body !== undefined) headers["content-type"] = "application/json";
		if (input.method !== "GET") {
			headers["idempotency-key"] = input.idempotencyKey ?? crypto.randomUUID();
		}

		let attempt = 0;
		for (;;) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.timeoutMs);
			let response: Response;
			try {
				response = await this.fetchImpl(url.toString(), {
					method: input.method,
					headers,
					body:
						input.body === undefined ? undefined : JSON.stringify(input.body),
					signal: controller.signal,
				});
			} catch (error) {
				clearTimeout(timer);
				if (attempt < this.maxRetries) {
					await sleep(backoffMs(attempt));
					attempt += 1;
					continue;
				}
				throw new CubeError("network error", 0, undefined, error);
			}
			clearTimeout(timer);

			if (
				(response.status === 429 || response.status >= 500) &&
				attempt < this.maxRetries
			) {
				const retryAfter = Number(response.headers.get("retry-after"));
				await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
				attempt += 1;
				continue;
			}

			const text = await response.text();
			const data = text ? (JSON.parse(text) as unknown) : undefined;
			if (!response.ok) {
				const message =
					(data as { error?: string } | undefined)?.error ??
					`request failed (${response.status})`;
				throw new CubeError(message, response.status, data);
			}
			return data as T;
		}
	}
}
