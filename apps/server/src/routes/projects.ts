import type { Database } from "@cube/db";
import { projects } from "@cube/db";
import { desc, eq } from "drizzle-orm";
import { Router } from "express";

import { getAuth, requireSession } from "../auth/middleware";
import { db } from "../services";

export type ProjectSummary = {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	defaultCurrency: string;
};

export async function loadProjects(
	database: Database,
	userId: string,
): Promise<ProjectSummary[]> {
	return database
		.select({
			id: projects.id,
			name: projects.name,
			slug: projects.slug,
			description: projects.description,
			defaultCurrency: projects.defaultCurrency,
		})
		.from(projects)
		.where(eq(projects.userId, userId))
		.orderBy(desc(projects.createdAt));
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
