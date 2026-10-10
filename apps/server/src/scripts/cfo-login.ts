import { login } from "@cube/agent";

import { agentConfig } from "../config";

const oauth = agentConfig.cfo.oauth;
if (!oauth) {
	console.error("cfo.ai OAuth is not configured");
	process.exit(1);
}

console.log("Starting cfo.ai OAuth login…");
try {
	const tokens = await login({
		mcpUrl: agentConfig.cfo.mcpUrl,
		credentialsPath: oauth.credentialsPath,
		redirectPort: oauth.redirectPort,
		scope: oauth.scope,
	});
	console.log(`\n✓ cfo.ai connected. Tokens saved to ${oauth.credentialsPath}`);
	console.log(
		tokens.expires_at
			? `  Access token expires ${new Date(tokens.expires_at).toLocaleString()}`
			: "  Access token has no expiry",
	);
	process.exit(0);
} catch (error) {
	console.error(
		"\n✗ cfo.ai login failed:",
		error instanceof Error ? error.message : error,
	);
	process.exit(1);
}
