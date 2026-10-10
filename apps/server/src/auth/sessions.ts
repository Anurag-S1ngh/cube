import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@cube/db";
import { sessions, users } from "@cube/db";
import { eq, lt } from "drizzle-orm";

export type SessionUser = {
	id: string;
	username: string;
	email: string;
};

const SESSION_TOKEN_BYTES = 32;

export function hashSessionToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a new opaque session token. Only the hash is stored; the raw token is
 * returned once so it can be placed in the httpOnly cookie.
 */
export async function createSession(
	db: Database,
	input: {
		userId: string;
		ttlDays: number;
		userAgent?: string | null;
		ip?: string | null;
	},
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
	const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
	await db.insert(sessions).values({
		userId: input.userId,
		tokenHash: hashSessionToken(token),
		userAgent: input.userAgent ?? null,
		ip: input.ip ?? null,
		expiresAt,
	});
	return { token, expiresAt };
}

/** Resolve a raw session token to its user, or null if invalid/expired. */
export async function resolveSession(
	db: Database,
	token: string | undefined,
): Promise<{ user: SessionUser; sessionId: string } | null> {
	if (!token) return null;

	const [row] = await db
		.select({
			sessionId: sessions.id,
			expiresAt: sessions.expiresAt,
			id: users.id,
			username: users.username,
			email: users.email,
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.tokenHash, hashSessionToken(token)))
		.limit(1);

	if (!row) return null;

	if (row.expiresAt.getTime() <= Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, row.sessionId));
		return null;
	}

	await db
		.update(sessions)
		.set({ lastSeenAt: new Date() })
		.where(eq(sessions.id, row.sessionId));

	return {
		user: { id: row.id, username: row.username, email: row.email },
		sessionId: row.sessionId,
	};
}

export async function revokeSession(
	db: Database,
	token: string | undefined,
): Promise<void> {
	if (!token) return;
	await db
		.delete(sessions)
		.where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** Best-effort cleanup of expired sessions (call on boot). */
export async function pruneExpiredSessions(db: Database): Promise<number> {
	const deleted = await db
		.delete(sessions)
		.where(lt(sessions.expiresAt, new Date()))
		.returning({ id: sessions.id });
	return deleted.length;
}
