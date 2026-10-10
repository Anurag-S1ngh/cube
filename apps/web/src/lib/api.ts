import { cookies } from "next/headers";

import { SERVER_URL } from "@/lib/config";
import type {
	InvestigationDetail,
	InvestigationPage,
	Summary,
} from "@/lib/types";

export type {
	EmailAction,
	InvestigationDetail,
	InvestigationListItem,
	InvestigationPage,
	Summary,
} from "@/lib/types";

/** Thrown when the API rejects the request for lack of a valid session. */
export class AuthError extends Error {}

async function getJson<T>(path: string): Promise<T> {
	const store = await cookies();
	const cookie = store.toString();
	const res = await fetch(`${SERVER_URL}${path}`, {
		cache: "no-store",
		headers: cookie ? { cookie } : undefined,
	});
	if (res.status === 401) {
		throw new AuthError(`unauthorized: ${path}`);
	}
	if (!res.ok) {
		throw new Error(`request failed: ${path} (${res.status})`);
	}
	return (await res.json()) as T;
}

export type InvestigationQuery = {
	q?: string;
	status?: string;
	severity?: string;
	sort?: string;
	order?: string;
	page?: number;
	pageSize?: number;
};

export function getSummary(): Promise<Summary> {
	return getJson<Summary>("/investigations/summary");
}

export function getInvestigations(
	query: InvestigationQuery = {},
): Promise<InvestigationPage> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== "" && value !== "all") {
			params.set(key, String(value));
		}
	}
	const qs = params.toString();
	return getJson<InvestigationPage>(
		`/investigations${qs ? `?${qs}` : ""}`,
	);
}

export function getInvestigation(id: string): Promise<InvestigationDetail> {
	return getJson<InvestigationDetail>(`/investigations/${id}`);
}
