import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@cube/db";
import { apiKeys } from "@cube/db";
import { eq } from "drizzle-orm";

export type VerifiedApiKey = {
	id: string;
	projectId: string;
	name: string;
	keyPrefix: string;
};

/** API keys are `cube_<prefix>_<secret>`; only a SHA-256 hash is persisted. */
const KEY_PREFIX = "cube";

export function hashApiKey(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): {
	raw: string;
	keyPrefix: string;
	keyHash: string;
} {
	const prefix = randomBytes(6).toString("hex");
	const secret = randomBytes(24).toString("base64url");
	const raw = `${KEY_PREFIX}_${prefix}_${secret}`;
	return {
		raw,
		keyPrefix: `${KEY_PREFIX}_${prefix}`,
		keyHash: hashApiKey(raw),
	};
}

/**
 * Validate a raw API key. Returns the owning project, or null when the key is
 * unknown, revoked, or expired. Touches `lastUsedAt` on success.
 */
export async function verifyApiKey(
	db: Database,
	raw: string | undefined,
): Promise<VerifiedApiKey | null> {
	if (!raw?.startsWith(`${KEY_PREFIX}_`)) return null;

	const [key] = await db
		.select()
		.from(apiKeys)
		.where(eq(apiKeys.keyHash, hashApiKey(raw)))
		.limit(1);

	if (!key) return null;
	if (key.revokedAt) return null;
	if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;

	await db
		.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, key.id));

	return {
		id: key.id,
		projectId: key.projectId,
		name: key.name,
		keyPrefix: key.keyPrefix,
	};
}
