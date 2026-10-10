import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@cube/db";
import { passwordResetTokens, sessions } from "@cube/db";
import { eq } from "drizzle-orm";

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** Issue a single-use, expiring reset token. Returns the raw token to email. */
export async function createPasswordResetToken(
	db: Database,
	userId: string,
	ttlMinutes: number,
): Promise<string> {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
	await db.insert(passwordResetTokens).values({
		userId,
		tokenHash: hashToken(token),
		expiresAt,
	});
	return token;
}

/** Resolve a token to its user without consuming it, or null if invalid. */
export async function peekPasswordResetToken(
	db: Database,
	token: string | undefined,
): Promise<string | null> {
	if (!token) return null;
	const [row] = await db
		.select({
			userId: passwordResetTokens.userId,
			expiresAt: passwordResetTokens.expiresAt,
			usedAt: passwordResetTokens.usedAt,
		})
		.from(passwordResetTokens)
		.where(eq(passwordResetTokens.tokenHash, hashToken(token)))
		.limit(1);
	if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
	return row.userId;
}

/** Validate and burn a token, returning the user id (or null). */
export async function consumePasswordResetToken(
	db: Database,
	token: string | undefined,
): Promise<string | null> {
	const userId = await peekPasswordResetToken(db, token);
	if (!userId || !token) return null;
	await db
		.update(passwordResetTokens)
		.set({ usedAt: new Date() })
		.where(eq(passwordResetTokens.tokenHash, hashToken(token)));
	return userId;
}

/** Invalidate every active session for a user (e.g. after a password change). */
export async function revokeAllSessions(
	db: Database,
	userId: string,
): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}
