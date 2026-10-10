import type { Request, Response } from "express";

import { ENV } from "../env.server";

export const SESSION_COOKIE = ENV.SESSION_COOKIE_NAME;

const isProd = ENV.NODE_ENV === "production";

function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const idx = part.indexOf("=");
		if (idx === -1) continue;
		const key = part.slice(0, idx).trim();
		if (!key) continue;
		out[key] = decodeURIComponent(part.slice(idx + 1).trim());
	}
	return out;
}

export function getSessionCookie(req: Request): string | undefined {
	return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function setSessionCookie(
	res: Response,
	token: string,
	expiresAt: Date,
): void {
	res.cookie(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "lax",
		secure: isProd,
		path: "/",
		expires: expiresAt,
	});
}

export function clearSessionCookie(res: Response): void {
	res.clearCookie(SESSION_COOKIE, {
		httpOnly: true,
		sameSite: "lax",
		secure: isProd,
		path: "/",
	});
}
