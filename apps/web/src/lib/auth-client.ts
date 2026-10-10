import { SERVER_URL } from "@/lib/config";

export type SessionUser = {
	id: string;
	username: string;
	email: string;
};

export type ProjectSummary = {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	defaultCurrency: string;
};

export type Me = {
	user: SessionUser;
	projects: ProjectSummary[];
};

/**
 * Client-side auth calls. The browser talks to the API directly and stores the
 * httpOnly session cookie, so every request uses `credentials: "include"`.
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
		throw new Error(message);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export function login(
	email: string,
	password: string,
): Promise<{ user: SessionUser; expiresAt: string }> {
	return request("/auth/login", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
}

export function logout(): Promise<void> {
	return request("/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<Me | null> {
	const res = await fetch(`${SERVER_URL}/auth/me`, {
		credentials: "include",
		cache: "no-store",
	});
	if (res.status === 401) return null;
	if (!res.ok) throw new Error(`request failed (${res.status})`);
	return (await res.json()) as Me;
}
