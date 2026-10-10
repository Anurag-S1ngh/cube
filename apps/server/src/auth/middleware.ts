import type { Database } from "@cube/db";
import { projects } from "@cube/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { db } from "../services";
import type { VerifiedApiKey } from "./apiKeys";
import { verifyApiKey } from "./apiKeys";
import { getSessionCookie } from "./cookies";
import type { SessionUser } from "./sessions";
import { resolveSession } from "./sessions";

export type AuthContext =
	| { kind: "session"; user: SessionUser; sessionId: string }
	| { kind: "apiKey"; key: VerifiedApiKey };

export function getAuth(res: Response): AuthContext | undefined {
	return (res.locals as { auth?: AuthContext }).auth;
}

/** Extract a machine credential from `Authorization: Bearer` or `x-api-key`. */
function machineCredential(req: Request): string | undefined {
	const header = req.header("authorization");
	if (header?.toLowerCase().startsWith("bearer ")) {
		return header.slice(7).trim();
	}
	return req.header("x-api-key") ?? undefined;
}

async function resolveAuthContext(
	database: Database,
	req: Request,
): Promise<AuthContext | undefined> {
	const session = await resolveSession(database, getSessionCookie(req));
	if (session) {
		return {
			kind: "session",
			user: session.user,
			sessionId: session.sessionId,
		};
	}
	const key = await verifyApiKey(database, machineCredential(req));
	if (key) return { kind: "apiKey", key };
	return undefined;
}

async function attach(
	database: Database,
	req: Request,
	res: Response,
): Promise<AuthContext | undefined> {
	const auth = await resolveAuthContext(database, req);
	if (auth) (res.locals as { auth?: AuthContext }).auth = auth;
	return auth;
}

/** Accepts either a dashboard session or a project API key. */
export function requireAuth(_database: Database = db) {
	return async (req: Request, res: Response, next: NextFunction) => {
		const auth = await attach(_database, req, res);
		if (!auth) {
			res.status(401).json({ error: "authentication required" });
			return;
		}
		next();
	};
}

/** Dashboard-only: a valid user session. */
export function requireSession(database: Database = db) {
	return async (req: Request, res: Response, next: NextFunction) => {
		const auth = await resolveAuthContext(database, req);
		if (auth?.kind !== "session") {
			res.status(401).json({ error: "session required" });
			return;
		}
		(res.locals as { auth?: AuthContext }).auth = auth;
		next();
	};
}

/** Machine-only: a valid project API key. */
export function requireApiKey(database: Database = db) {
	return async (req: Request, res: Response, next: NextFunction) => {
		const auth = await resolveAuthContext(database, req);
		if (auth?.kind !== "apiKey") {
			res.status(401).json({ error: "API key required" });
			return;
		}
		(res.locals as { auth?: AuthContext }).auth = auth;
		next();
	};
}

/**
 * Project ids the caller may see. A session sees every project it owns; an API
 * key sees exactly its own project.
 */
export async function accessibleProjectIds(
	database: Database,
	auth: AuthContext,
): Promise<string[]> {
	if (auth.kind === "apiKey") return [auth.key.projectId];
	const rows = await database
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.userId, auth.user.id));
	return rows.map((row) => row.id);
}
