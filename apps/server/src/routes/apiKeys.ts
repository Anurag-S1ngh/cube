import { apiKeys, projects } from "@cube/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";

import { generateApiKey } from "../auth/apiKeys";
import { getAuth, requireSession } from "../auth/middleware";
import { db } from "../services";

export const apiKeysRouter = Router();

apiKeysRouter.use(requireSession());

async function ownedProjectIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.userId, userId));
	return rows.map((row) => row.id);
}

apiKeysRouter.get("/", async (_req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const projectIds = await ownedProjectIds(auth.user.id);
	if (projectIds.length === 0) {
		res.json({ apiKeys: [] });
		return;
	}
	const rows = await db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			keyPrefix: apiKeys.keyPrefix,
			projectId: apiKeys.projectId,
			projectName: projects.name,
			lastUsedAt: apiKeys.lastUsedAt,
			expiresAt: apiKeys.expiresAt,
			revokedAt: apiKeys.revokedAt,
			createdAt: apiKeys.createdAt,
		})
		.from(apiKeys)
		.innerJoin(projects, eq(projects.id, apiKeys.projectId))
		.where(inArray(apiKeys.projectId, projectIds))
		.orderBy(desc(apiKeys.createdAt));
	res.json({ apiKeys: rows });
});

apiKeysRouter.post("/", async (req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}

	const body = (req.body ?? {}) as Record<string, unknown>;
	const projectId = typeof body.projectId === "string" ? body.projectId : "";
	if (!projectId) {
		res.status(400).json({ error: "projectId is required" });
		return;
	}

	const projectIds = await ownedProjectIds(auth.user.id);
	if (!projectIds.includes(projectId)) {
		res.status(404).json({ error: "project not found" });
		return;
	}

	const name =
		typeof body.name === "string" && body.name.trim()
			? body.name.trim()
			: `API key (${new Date().toISOString().slice(0, 10)})`;

	let expiresAt: Date | null = null;
	if (typeof body.expiresAt === "string" && body.expiresAt) {
		const parsed = new Date(body.expiresAt);
		if (Number.isNaN(parsed.getTime())) {
			res.status(400).json({ error: "expiresAt is not a valid date" });
			return;
		}
		expiresAt = parsed;
	}

	const { raw, keyPrefix, keyHash } = generateApiKey();
	const [created] = await db
		.insert(apiKeys)
		.values({ projectId, name, keyPrefix, keyHash, expiresAt })
		.returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });

	// The raw key is returned exactly once; only its hash is stored.
	res.status(201).json({
		apiKey: {
			id: created?.id,
			name,
			keyPrefix,
			projectId,
			expiresAt,
			createdAt: created?.createdAt,
		},
		secret: raw,
	});
});

apiKeysRouter.delete("/:id", async (req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const id = typeof req.params.id === "string" ? req.params.id : "";
	const projectIds = await ownedProjectIds(auth.user.id);
	if (projectIds.length === 0) {
		res.status(404).json({ error: "API key not found" });
		return;
	}

	const revoked = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.id, id), inArray(apiKeys.projectId, projectIds)))
		.returning({ id: apiKeys.id });

	if (revoked.length === 0) {
		res.status(404).json({ error: "API key not found" });
		return;
	}
	res.status(204).end();
});
