import { cookies } from "next/headers";

import { SERVER_URL } from "@/lib/config";
import type {
	InvestigationDetail,
	InvestigationListItem,
	Summary,
} from "@/lib/types";

export type {
	EmailAction,
	InvestigationDetail,
	InvestigationListItem,
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

export function getSummary(): Promise<Summary> {
	return getJson<Summary>("/investigations/summary");
}

export async function getInvestigations(): Promise<InvestigationListItem[]> {
	const data = await getJson<{ investigations: InvestigationListItem[] }>(
		"/investigations",
	);
	return data.investigations;
}

export function getInvestigation(id: string): Promise<InvestigationDetail> {
	return getJson<InvestigationDetail>(`/investigations/${id}`);
}
