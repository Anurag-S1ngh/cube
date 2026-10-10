import { redirect } from "next/navigation";

import { ApiKeyManager } from "@/components/api-key-manager";
import { AuthError, getApiKeys, getProjects } from "@/lib/api";
import type { ApiKey, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "API keys" };

export default async function SettingsApiKeysPage() {
	let projects: Project[] = [];
	let apiKeys: ApiKey[] = [];

	try {
		[projects, apiKeys] = await Promise.all([getProjects(), getApiKeys()]);
	} catch (error) {
		if (error instanceof AuthError) redirect("/login");
		throw error;
	}

	return (
		<main className="container mx-auto max-w-4xl px-4 py-6">
			<h1 className="mb-6 font-semibold text-lg">API keys &amp; webhooks</h1>
			{projects.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Create a project before minting API keys.
				</p>
			) : (
				<ApiKeyManager projects={projects} apiKeys={apiKeys} />
			)}
		</main>
	);
}
