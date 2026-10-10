import { SERVER_URL } from "@/lib/config";

/** Error carrying the HTTP status so callers can react to 401/409 etc. */
export class ApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

/**
 * Browser-side API calls. Every request goes out with credentials so the
 * httpOnly session cookie (set by the API origin) is included.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${SERVER_URL}${path}`, {
		...init,
		credentials: "include",
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	if (!res.ok) {
		let message = `request failed (${res.status})`;
		try {
			const data = (await res.json()) as { error?: string };
			if (data?.error) message = data.error;
		} catch {
			// ignore non-JSON bodies
		}
		throw new ApiError(message, res.status);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export type DecisionOutcome = {
	investigationId: string;
	decision: "approved" | "rejected";
	emailStatus: "queued" | "sent" | "blocked" | "failed";
};

export function approveEmail(
	investigationId: string,
): Promise<DecisionOutcome> {
	return request(`/investigations/${investigationId}/approve`, {
		method: "POST",
	});
}

export function rejectEmail(
	investigationId: string,
	reason?: string,
): Promise<DecisionOutcome> {
	return request(`/investigations/${investigationId}/reject`, {
		method: "POST",
		body: JSON.stringify(reason ? { reason } : {}),
	});
}

export function simulateFailures(
	count = 6,
): Promise<{ created: number; investigations: string[] }> {
	return request(`/mock/simulate?count=${count}`, { method: "POST" });
}

export type CreatedApiKey = {
	apiKey: {
		id: string;
		name: string;
		keyPrefix: string;
		projectId: string;
		createdAt: string;
	};
	secret: string;
};

export function createApiKey(
	projectId: string,
	name: string,
): Promise<CreatedApiKey> {
	return request("/api-keys", {
		method: "POST",
		body: JSON.stringify({ projectId, name }),
	});
}

export function revokeApiKey(id: string): Promise<void> {
	return request(`/api-keys/${id}`, { method: "DELETE" });
}

export function getWebhookSecret(
	projectId: string,
): Promise<{ webhookUrl: string; webhookSecret: string | null }> {
	return request(`/projects/${projectId}/webhook-secret`);
}

export function rotateWebhookSecret(
	projectId: string,
): Promise<{ webhookUrl: string; webhookSecret: string }> {
	return request(`/projects/${projectId}/webhook-secret`, { method: "POST" });
}
