import { randomBytes } from "node:crypto";

import type { Database } from "@cube/db";
import { apiKeys, projects, users } from "@cube/db";
import { eq } from "drizzle-orm";
import { generateWebhookSecret } from "../webhookSecret";
import { generateApiKey } from "./apiKeys";
import { hashPassword } from "./password";

export class RegisterError extends Error {
	readonly status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.name = "RegisterError";
		this.status = status;
	}
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type RegisterInput = {
	email: string;
	password: string;
	name?: string;
	projectName?: string;
};

export type RegisterResult = {
	user: { id: string; username: string; email: string };
	project: { id: string; name: string; slug: string };
	apiKey: string;
	webhookSecret: string;
};

function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
		.slice(0, 40);
	return slug || `project-${randomBytes(3).toString("hex")}`;
}

async function uniqueUsername(
	database: Database,
	base: string,
): Promise<string> {
	const safe =
		(base || "user").replace(/[^a-z0-9._-]/gi, "").slice(0, 24) || "user";
	let candidate = safe;
	for (let i = 0; i < 5; i += 1) {
		const [existing] = await database
			.select({ id: users.id })
			.from(users)
			.where(eq(users.username, candidate))
			.limit(1);
		if (!existing) return candidate;
		candidate = `${safe}-${randomBytes(2).toString("hex")}`;
	}
	return `${safe}-${randomBytes(4).toString("hex")}`;
}

async function uniqueSlug(database: Database, base: string): Promise<string> {
	let candidate = base;
	for (let i = 0; i < 5; i += 1) {
		const [existing] = await database
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.slug, candidate))
			.limit(1);
		if (!existing) return candidate;
		candidate = `${base}-${randomBytes(2).toString("hex")}`;
	}
	return `${base}-${randomBytes(4).toString("hex")}`;
}

/** Create a user, their first project, an API key and a webhook secret. */
export async function register(
	database: Database,
	input: RegisterInput,
): Promise<RegisterResult> {
	const email = input.email.trim().toLowerCase();
	if (!emailPattern.test(email)) {
		throw new RegisterError("a valid email is required");
	}
	if (
		input.password.length < MIN_PASSWORD_LENGTH ||
		input.password.length > 200
	) {
		throw new RegisterError(
			`password must be at least ${MIN_PASSWORD_LENGTH} characters`,
		);
	}

	const [existing] = await database
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	if (existing) {
		throw new RegisterError("an account with this email already exists", 409);
	}

	const passwordHash = await hashPassword(input.password);
	const username = await uniqueUsername(
		database,
		input.name ?? email.split("@")[0] ?? "user",
	);
	const slug = await uniqueSlug(
		database,
		slugify(input.projectName ?? `${email.split("@")[0]}'s workspace`),
	);

	const generatedKey = generateApiKey();
	const webhookSecret = generateWebhookSecret();

	return database.transaction(async (tx) => {
		const [user] = await tx
			.insert(users)
			.values({ username, email, passwordHash })
			.returning({
				id: users.id,
				username: users.username,
				email: users.email,
			});
		if (!user) throw new RegisterError("failed to create user");

		const [project] = await tx
			.insert(projects)
			.values({
				name: input.projectName?.trim() || "My workspace",
				slug,
				userId: user.id,
				defaultCurrency: "USD",
				webhookSecret,
			})
			.returning({ id: projects.id, name: projects.name, slug: projects.slug });
		if (!project) throw new RegisterError("failed to create project");

		await tx.insert(apiKeys).values({
			projectId: project.id,
			name: "Default API key",
			keyPrefix: generatedKey.keyPrefix,
			keyHash: generatedKey.keyHash,
		});

		return {
			user,
			project,
			apiKey: generatedKey.raw,
			webhookSecret,
		};
	});
}
