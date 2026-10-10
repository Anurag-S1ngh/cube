/**
 * Password hashing. Uses Bun's built-in Argon2id implementation, so there is no
 * native dependency to compile and no plaintext ever touches the database.
 */

const HASH_OPTIONS = { algorithm: "argon2id", memoryCost: 19456 } as const;

export function hashPassword(password: string): Promise<string> {
	return Bun.password.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(
	password: string,
	hash: string | null,
): Promise<boolean> {
	if (!hash) return false;
	try {
		return await Bun.password.verify(password, hash);
	} catch {
		return false;
	}
}
