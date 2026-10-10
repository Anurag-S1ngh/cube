import { projects, webhookDeliveries, webhookEndpoints } from "@cube/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";

import { getAuth, requireSession } from "../auth/middleware";
import { db } from "../services";
import { generateWebhookSecret } from "../webhookSecret";

export const webhookEndpointsRouter = Router();

webhookEndpointsRouter.use(requireSession());

const knownEvents = new Set([
	"investigation.created",
	"investigation.classified",
	"investigation.actioned",
	"investigation.escalated",
	"investigation.resolved",
	"email.queued",
	"email.sent",
	"email.blocked",
	"email.failed",
]);

async function ownedProjectIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.userId, userId));
	return rows.map((row) => row.id);
}

function validUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

webhookEndpointsRouter.get("/", async (_req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const projectIds = await ownedProjectIds(auth.user.id);
	if (projectIds.length === 0) {
		res.json({ endpoints: [] });
		return;
	}
	const rows = await db
		.select()
		.from(webhookEndpoints)
		.where(inArray(webhookEndpoints.projectId, projectIds))
		.orderBy(desc(webhookEndpoints.createdAt));
	res.json({ endpoints: rows });
});

webhookEndpointsRouter.post("/", async (req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const body = (req.body ?? {}) as Record<string, unknown>;
	const projectId = typeof body.projectId === "string" ? body.projectId : "";
	const url = typeof body.url === "string" ? body.url.trim() : "";
	if (!projectId || !url) {
		res.status(400).json({ error: "projectId and url are required" });
		return;
	}
	if (!validUrl(url)) {
		res.status(400).json({ error: "url must be a valid http(s) URL" });
		return;
	}
	const projectIds = await ownedProjectIds(auth.user.id);
	if (!projectIds.includes(projectId)) {
		res.status(404).json({ error: "project not found" });
		return;
	}
	const events = Array.isArray(body.events)
		? body.events.filter(
				(event): event is string =>
					typeof event === "string" && knownEvents.has(event),
			)
		: [];
	const description =
		typeof body.description === "string" ? body.description.trim() : null;

	const secret = generateWebhookSecret();
	const [created] = await db
		.insert(webhookEndpoints)
		.values({ projectId, url, secret, events, description })
		.returning();

	res.status(201).json({ endpoint: created });
});

webhookEndpointsRouter.get("/:id/deliveries", async (req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const id = typeof req.params.id === "string" ? req.params.id : "";
	const projectIds = await ownedProjectIds(auth.user.id);
	if (projectIds.length === 0) {
		res.json({ deliveries: [] });
		return;
	}
	const [endpoint] = await db
		.select({ id: webhookEndpoints.id })
		.from(webhookEndpoints)
		.where(
			and(
				eq(webhookEndpoints.id, id),
				inArray(webhookEndpoints.projectId, projectIds),
			),
		)
		.limit(1);
	if (!endpoint) {
		res.status(404).json({ error: "endpoint not found" });
		return;
	}
	const deliveries = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.endpointId, id))
		.orderBy(desc(webhookDeliveries.createdAt))
		.limit(50);
	res.json({ deliveries });
});

webhookEndpointsRouter.delete("/:id", async (req, res) => {
	const auth = getAuth(res);
	if (auth?.kind !== "session") {
		res.status(401).json({ error: "session required" });
		return;
	}
	const id = typeof req.params.id === "string" ? req.params.id : "";
	const projectIds = await ownedProjectIds(auth.user.id);
	if (projectIds.length === 0) {
		res.status(404).json({ error: "endpoint not found" });
		return;
	}
	const deleted = await db
		.delete(webhookEndpoints)
		.where(
			and(
				eq(webhookEndpoints.id, id),
				inArray(webhookEndpoints.projectId, projectIds),
			),
		)
		.returning({ id: webhookEndpoints.id });
	if (deleted.length === 0) {
		res.status(404).json({ error: "endpoint not found" });
		return;
	}
	res.status(204).end();
});
