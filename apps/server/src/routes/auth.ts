import { users } from "@cube/db";
import { eq, or } from "drizzle-orm";
import { Router } from "express";

import {
	clearSessionCookie,
	getSessionCookie,
	setSessionCookie,
} from "../auth/cookies";
import { getAuth, requireSession } from "../auth/middleware";
import { hashPassword, verifyPassword } from "../auth/password";
import { checkRateLimit, resetRateLimit } from "../auth/rateLimit";
import { RegisterError, register } from "../auth/register";
import { createSession, revokeSession } from "../auth/sessions";
import { ENV } from "../env.server";
import { db } from "../services";
import { loadProjects } from "./projects";

export const authRouter = Router();

// A hash to verify against when the user does not exist, so login latency does
// not reveal whether an account is registered.
const DUMMY_HASH = await hashPassword("cube-dummy-password");

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

authRouter.post("/login", async (req, res) => {
	const body = (req.body ?? {}) as Record<string, unknown>;
	const identifier =
		stringField(body.email) ?? stringField(body.username) ?? "";
	const password = typeof body.password === "string" ? body.password : "";

	if (!identifier || !password) {
		res.status(400).json({ error: "email and password are required" });
		return;
	}

	const ip = req.ip ?? "unknown";
	const limitKey = `login:${ip}:${identifier.toLowerCase()}`;
	const limit = checkRateLimit(limitKey, {
		max: ENV.AUTH_LOGIN_MAX_ATTEMPTS,
		windowMs: ENV.AUTH_LOGIN_WINDOW_MINUTES * 60_000,
	});
	if (!limit.allowed) {
		res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
		res.status(429).json({ error: "too many attempts, try again later" });
		return;
	}

	const [user] = await db
		.select()
		.from(users)
		.where(
			or(
				eq(users.email, identifier.toLowerCase()),
				eq(users.username, identifier),
			),
		)
		.limit(1);

	const valid = await verifyPassword(
		password,
		user?.passwordHash ?? DUMMY_HASH,
	);
	if (!user || !valid) {
		res.status(401).json({ error: "invalid credentials" });
		return;
	}

	resetRateLimit(limitKey);

	const { token, expiresAt } = await createSession(db, {
		userId: user.id,
		ttlDays: ENV.SESSION_TTL_DAYS,
		userAgent: req.header("user-agent") ?? null,
		ip,
	});
	setSessionCookie(res, token, expiresAt);

	res.json({
		user: { id: user.id, username: user.username, email: user.email },
		expiresAt: expiresAt.toISOString(),
	});
});

authRouter.post("/register", async (req, res) => {
	const body = (req.body ?? {}) as Record<string, unknown>;
	const email = stringField(body.email) ?? "";
	const password = typeof body.password === "string" ? body.password : "";
	const name = stringField(body.name);
	const projectName = stringField(body.projectName);

	const ip = req.ip ?? "unknown";
	const limit = checkRateLimit(`register:${ip}`, {
		max: ENV.AUTH_LOGIN_MAX_ATTEMPTS,
		windowMs: ENV.AUTH_LOGIN_WINDOW_MINUTES * 60_000,
	});
	if (!limit.allowed) {
		res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
		res.status(429).json({ error: "too many attempts, try again later" });
		return;
	}

	let created: Awaited<ReturnType<typeof register>>;
	try {
		created = await register(db, { email, password, name, projectName });
	} catch (error) {
		if (error instanceof RegisterError) {
			res.status(error.status).json({ error: error.message });
			return;
		}
		throw error;
	}

	const { token, expiresAt } = await createSession(db, {
		userId: created.user.id,
		ttlDays: ENV.SESSION_TTL_DAYS,
		userAgent: req.header("user-agent") ?? null,
		ip,
	});
	setSessionCookie(res, token, expiresAt);

	res.status(201).json({
		user: created.user,
		project: created.project,
		apiKey: created.apiKey,
		webhookSecret: created.webhookSecret,
	});
});

authRouter.post("/logout", async (req, res) => {
	await revokeSession(db, getSessionCookie(req));
	clearSessionCookie(res);
	res.status(204).end();
});

authRouter.get("/me", requireSession(), async (_req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const projectList = await loadProjects(db, auth.user.id);
	res.json({ user: auth.user, projects: projectList });
});
