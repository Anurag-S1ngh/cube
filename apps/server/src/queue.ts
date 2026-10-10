import { createInvestigationQueue } from "@cube/agent";

import { agentConfig } from "./config";
import { db } from "./services";

export const queue = createInvestigationQueue({
	db,
	config: agentConfig,
	onError: (investigationId, error) => {
		console.error(
			`[queue] investigation ${investigationId} failed permanently`,
			error,
		);
	},
});
