import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
	return PUBLIC_PATHS.some(
		(path) => pathname === path || pathname.startsWith(`${path}/`),
	);
}

/**
 * Cheap, optimistic gate: redirect anonymous users to /login and bounce
 * signed-in users away from /login. The API still validates the session on
 * every request, so a stale cookie cannot access data.
 */
export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	const hasSession = request.cookies.has(SESSION_COOKIE);

	if (!hasSession && !isPublic(pathname)) {
		const url = request.nextUrl.clone();
		url.pathname = "/login";
		url.search = "";
		if (pathname !== "/") url.searchParams.set("next", pathname);
		return NextResponse.redirect(url);
	}

	if (hasSession && pathname === "/login") {
		const url = request.nextUrl.clone();
		url.pathname = "/";
		url.search = "";
		return NextResponse.redirect(url);
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
	],
};
