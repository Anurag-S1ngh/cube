import { initObservability } from "@cube/agent";
import cors from "cors";
import { sql } from "drizzle-orm";
import express from "express";

import { pruneExpiredSessions } from "./auth/sessions";
import { agentConfig } from "./config";
import { ENV } from "./env.server";
import { queue } from "./queue";
import { apiKeysRouter } from "./routes/apiKeys";
import { authRouter } from "./routes/auth";
import { eventsRouter } from "./routes/events";
import { investigationsRouter } from "./routes/investigations";
import { mockRouter } from "./routes/mock";
import { projectsRouter } from "./routes/projects";
import { webhooksRouter } from "./routes/webhooks";
import { db } from "./services";
import type { RawBodyRequest } from "./types";

await initObservability(agentConfig);

const app = express();

app.use(
	cors({
		origin: ENV.CORS_ORIGIN,
		methods: ["GET", "POST", "DELETE", "OPTIONS"],
		credentials: true,
	}),
);

// Keep the raw body so webhook signatures can be verified.
app.use(
	express.json({
		verify: (req, _res, buf) => {
			(req as RawBodyRequest).rawBody = Buffer.from(buf);
		},
	}),
);

app.get("/", (_req, res) => {
	res.status(200).send("OK");
});

app.get("/health", async (_req, res) => {
	try {
		await db.execute(sql`select 1`);
		res.json({
			status: "ok",
			db: "up",
			uptimeSeconds: Math.round(process.uptime()),
		});
	} catch (error) {
		res.status(503).json({
			status: "degraded",
			db: "down",
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

app.use("/auth", authRouter);
app.use("/projects", projectsRouter);
app.use("/api-keys", apiKeysRouter);
app.use("/events", eventsRouter);
app.use("/webhooks", webhooksRouter);
app.use("/investigations", investigationsRouter);
app.use("/mock", mockRouter);

app.use(
	(
		err: unknown,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) => {
		console.error("[server] unhandled error", err);
		res.status(500).json({ error: "internal server error" });
	},
);

app.listen(3000, () => {
	console.log("Server is running on http://localhost:3000");
	void pruneExpiredSessions(db)
		.then((count) => {
			if (count > 0) console.log(`[auth] pruned ${count} expired sessions`);
		})
		.catch((error) => {
			console.error("[auth] session prune failed", error);
		});
	void queue
		.recover()
		.then((count) => {
			if (count > 0) {
				console.log(`[queue] recovered ${count} pending investigations`);
			}
		})
		.catch((error) => {
			console.error("[queue] recovery failed", error);
		});
});
