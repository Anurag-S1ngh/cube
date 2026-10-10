import { sendEmail } from "@cube/agent";
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
import {
	consumePasswordResetToken,
	createPasswordResetToken,
	peekPasswordResetToken,
	revokeAllSessions,
} from "../auth/passwordReset";
import { checkRateLimit, resetRateLimit } from "../auth/rateLimit";
import { RegisterError, register } from "../auth/register";
import { createSession, revokeSession } from "../auth/sessions";
import { agentConfig } from "../config";
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

authRouter.post("/password/request", async (req, res) => {
	const body = (req.body ?? {}) as Record<string, unknown>;
	const email = stringField(body.email) ?? "";

	const ip = req.ip ?? "unknown";
	const limit = checkRateLimit(`pwreset:${ip}`, {
		max: ENV.AUTH_LOGIN_MAX_ATTEMPTS,
		windowMs: ENV.AUTH_LOGIN_WINDOW_MINUTES * 60_000,
	});
	if (!limit.allowed) {
		res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
		res.status(429).json({ error: "too many attempts, try again later" });
		return;
	}

	// Always respond the same way so we never reveal whether an account exists.
	if (email) {
		const [user] = await db
			.select({ id: users.id, email: users.email })
			.from(users)
			.where(eq(users.email, email.toLowerCase()))
			.limit(1);
		if (user) {
			const token = await createPasswordResetToken(
				db,
				user.id,
				ENV.PASSWORD_RESET_TTL_MINUTES,
			);
			const link = `${ENV.WEB_APP_URL}/reset-password?token=${encodeURIComponent(
				token,
			)}`;
			try {
				await sendEmail(agentConfig, {
					to: user.email,
					subject: "Reset your Cube password",
					body: `Hi,

We received a request to reset your Cube password. This link expires in ${ENV.PASSWORD_RESET_TTL_MINUTES} minutes:

${link}

If you didn't request this, you can safely ignore this email.

— Cube`,
				});
			} catch (error) {
				console.error("[auth] password reset email failed", error);
			}
		}
	}

	res.status(202).json({ ok: true });
});

authRouter.get("/password/verify", async (req, res) => {
	const token =
		typeof req.query.token === "string" ? req.query.token : undefined;
	const userId = await peekPasswordResetToken(db, token);
	res.json({ valid: Boolean(userId) });
});

authRouter.post("/password/reset", async (req, res) => {
	const body = (req.body ?? {}) as Record<string, unknown>;
	const token = stringField(body.token) ?? "";
	const password = typeof body.password === "string" ? body.password : "";

	if (!token) {
		res.status(400).json({ error: "a reset token is required" });
		return;
	}
	if (password.length < 8 || password.length > 200) {
		res.status(400).json({ error: "password must be at least 8 characters" });
		return;
	}

	const userId = await consumePasswordResetToken(db, token);
	if (!userId) {
		res.status(400).json({ error: "invalid or expired reset link" });
		return;
	}

	const passwordHash = await hashPassword(password);
	await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
	// A password change invalidates every existing session.
	await revokeAllSessions(db, userId);

	res.json({ ok: true });
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
