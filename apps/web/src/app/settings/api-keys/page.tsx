import { redirect } from "next/navigation";

import { ApiKeyManager } from "@/components/api-key-manager";
import { WebhookEndpointsManager } from "@/components/webhook-endpoints-manager";
import {
	AuthError,
	getApiKeys,
	getProjects,
	getWebhookEndpoints,
} from "@/lib/api";
import type { ApiKey, Project, WebhookEndpoint } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "API keys" };

export default async function SettingsApiKeysPage() {
	let projects: Project[] = [];
	let apiKeys: ApiKey[] = [];
	let endpoints: WebhookEndpoint[] = [];

	try {
		[projects, apiKeys, endpoints] = await Promise.all([
			getProjects(),
			getApiKeys(),
			getWebhookEndpoints(),
		]);
	} catch (error) {
		if (error instanceof AuthError) redirect("/login");
		throw error;
	}

	return (
		<main className="container mx-auto max-w-4xl space-y-10 px-4 py-6">
			<h1 className="font-semibold text-lg">API keys &amp; webhooks</h1>
			{projects.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Create a project before minting API keys.
				</p>
			) : (
				<>
					<ApiKeyManager projects={projects} apiKeys={apiKeys} />
					<WebhookEndpointsManager projects={projects} endpoints={endpoints} />
				</>
			)}
		</main>
	);
}
