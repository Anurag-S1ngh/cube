import cors from "cors";
import express from "express";

import { ENV } from "./env.server";
import { queue } from "./queue";
import { investigationsRouter } from "./routes/investigations";
import { mockRouter } from "./routes/mock";
import { webhooksRouter } from "./routes/webhooks";
import type { RawBodyRequest } from "./types";

const app = express();

app.use(
	cors({
		origin: ENV.CORS_ORIGIN,
		methods: ["GET", "POST", "OPTIONS"],
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
