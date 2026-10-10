import type { Database } from "@cube/db";
import { projects } from "@cube/db";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";

import { getAuth, requireSession } from "../auth/middleware";
import { ENV } from "../env.server";
import { db } from "../services";
import { generateWebhookSecret } from "../webhookSecret";

export type ProjectSummary = {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	defaultCurrency: string;
	hasWebhookSecret: boolean;
};

export async function loadProjects(
	database: Database,
	userId: string,
): Promise<ProjectSummary[]> {
	const rows = await database
		.select({
			id: projects.id,
			name: projects.name,
			slug: projects.slug,
			description: projects.description,
			defaultCurrency: projects.defaultCurrency,
			webhookSecret: projects.webhookSecret,
		})
		.from(projects)
		.where(eq(projects.userId, userId))
		.orderBy(desc(projects.createdAt));
	return rows.map(({ webhookSecret, ...rest }) => ({
		...rest,
		hasWebhookSecret: Boolean(webhookSecret),
	}));
}

async function ownedProject(
	projectId: string,
	userId: string,
): Promise<{ id: string; webhookSecret: string | null } | null> {
	const [project] = await db
		.select({ id: projects.id, webhookSecret: projects.webhookSecret })
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
		.limit(1);
	return project ?? null;
}

export const projectsRouter = Router();

projectsRouter.get("/", requireSession(), async (_req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	res.json({ projects: await loadProjects(db, auth.user.id) });
});

// Return the project's current webhook endpoint + signing secret (owner only).
projectsRouter.get(
	"/:id/webhook-secret",
	requireSession(),
	async (req, res) => {
		const auth = getAuth(res);
		if (auth?.kind !== "session") {
			res.status(401).json({ error: "session required" });
			return;
		}
		const id = typeof req.params.id === "string" ? req.params.id : "";
		const project = await ownedProject(id, auth.user.id);
		if (!project) {
			res.status(404).json({ error: "project not found" });
			return;
		}
		res.json({
			webhookUrl: `${ENV.SERVER_PUBLIC_URL}/webhooks/stripe/${project.id}`,
			webhookSecret: project.webhookSecret,
		});
	},
);

// Rotate the project's webhook signing secret.
projectsRouter.post(
	"/:id/webhook-secret",
	requireSession(),
	async (req, res) => {
		const auth = getAuth(res);
		if (auth?.kind !== "session") {
			res.status(401).json({ error: "session required" });
			return;
		}
		const id = typeof req.params.id === "string" ? req.params.id : "";
		const project = await ownedProject(id, auth.user.id);
		if (!project) {
			res.status(404).json({ error: "project not found" });
			return;
		}
		const webhookSecret = generateWebhookSecret();
		await db
			.update(projects)
			.set({ webhookSecret })
			.where(eq(projects.id, project.id));
		res.json({
			webhookUrl: `${ENV.SERVER_PUBLIC_URL}/webhooks/stripe/${project.id}`,
			webhookSecret,
		});
	},
);
