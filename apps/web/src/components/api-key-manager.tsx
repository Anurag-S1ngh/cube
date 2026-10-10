"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { Label } from "@cube/ui/components/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
	ApiError,
	createApiKey,
	getWebhookSecret,
	revokeApiKey,
	rotateWebhookSecret,
} from "@/lib/api-client";
import type { ApiKey, Project } from "@/lib/types";

export function ApiKeyManager({
	projects,
	apiKeys,
}: {
	projects: Project[];
	apiKeys: ApiKey[];
}) {
	const router = useRouter();
	const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [newSecret, setNewSecret] = useState<{
		name: string;
		secret: string;
	} | null>(null);
	const [webhook, setWebhook] = useState<
		Record<string, { url: string; secret: string | null }>
	>({});

	function handleError(error: unknown): void {
		if (error instanceof ApiError && error.status === 401) {
			router.replace("/login");
			return;
		}
		toast.error(error instanceof Error ? error.message : "action failed");
	}

	async function onCreate(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!projectId) return;
		setPending(true);
		setNewSecret(null);
		try {
			const created = await createApiKey(projectId, name.trim() || "API key");
			setNewSecret({ name: created.apiKey.name, secret: created.secret });
			setName("");
			toast.success("API key created");
			router.refresh();
		} catch (error) {
			handleError(error);
		} finally {
			setPending(false);
		}
	}

	async function onRevoke(id: string) {
		try {
			await revokeApiKey(id);
			toast.success("API key revoked");
			router.refresh();
		} catch (error) {
			handleError(error);
		}
	}

	async function onReveal(project: Project) {
		try {
			const data = await getWebhookSecret(project.id);
			setWebhook((prev) => ({
				...prev,
				[project.id]: { url: data.webhookUrl, secret: data.webhookSecret },
			}));
		} catch (error) {
			handleError(error);
		}
	}

	async function onRotate(project: Project) {
		try {
			const data = await rotateWebhookSecret(project.id);
			setWebhook((prev) => ({
				...prev,
				[project.id]: { url: data.webhookUrl, secret: data.webhookSecret },
			}));
			toast.success("Webhook secret rotated");
		} catch (error) {
			handleError(error);
		}
	}

	return (
		<div className="space-y-8">
			<section className="space-y-3">
				<div>
					<h2 className="font-semibold text-base">API keys</h2>
					<p className="text-muted-foreground text-sm">
						Machine credentials for the REST API. Send one as{" "}
						<code className="text-[11px]">Authorization: Bearer …</code> or{" "}
						<code className="text-[11px]">x-api-key</code>.
					</p>
				</div>

				<form
					onSubmit={onCreate}
					className="flex flex-wrap items-end gap-2 rounded-md border p-3"
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="key-project">Project</Label>
						<select
							id="key-project"
							value={projectId}
							onChange={(event) => setProjectId(event.target.value)}
							className="h-8 rounded-md border bg-transparent px-2 text-sm"
						>
							{projects.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name}
								</option>
							))}
						</select>
					</div>
					<div className="flex min-w-48 flex-1 flex-col gap-1.5">
						<Label htmlFor="key-name">Name</Label>
						<Input
							id="key-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="CI deploy"
						/>
					</div>
					<Button type="submit" disabled={pending || !projectId}>
						{pending ? "Creating…" : "Create key"}
					</Button>
				</form>

				{newSecret ? (
					<div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
						<div className="font-medium">
							{newSecret.name} — copy it now, it won&apos;t be shown again.
						</div>
						<code className="mt-1 block break-all font-mono text-[11px]">
							{newSecret.secret}
						</code>
					</div>
				) : null}

				{apiKeys.length === 0 ? (
					<p className="text-muted-foreground text-sm">No API keys yet.</p>
				) : (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-left text-sm">
							<thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
								<tr>
									<th className="px-3 py-2 font-medium">Name</th>
									<th className="px-3 py-2 font-medium">Key</th>
									<th className="px-3 py-2 font-medium">Project</th>
									<th className="px-3 py-2 font-medium">Last used</th>
									<th className="px-3 py-2 font-medium">Status</th>
									<th className="px-3 py-2" />
								</tr>
							</thead>
							<tbody>
								{apiKeys.map((key) => (
									<tr key={key.id} className="border-t">
										<td className="px-3 py-2">{key.name}</td>
										<td className="px-3 py-2 font-mono text-[11px]">
											{key.keyPrefix}…
										</td>
										<td className="px-3 py-2 text-muted-foreground">
											{key.projectName}
										</td>
										<td className="px-3 py-2 text-muted-foreground text-xs">
											{key.lastUsedAt
												? new Date(key.lastUsedAt).toLocaleString()
												: "never"}
										</td>
										<td className="px-3 py-2 text-xs">
											{key.revokedAt ? (
												<span className="text-red-600 dark:text-red-400">
													revoked
												</span>
											) : (
												<span className="text-emerald-600 dark:text-emerald-400">
													active
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-right">
											{key.revokedAt ? null : (
												<Button
													variant="outline"
													size="sm"
													onClick={() => onRevoke(key.id)}
												>
													Revoke
												</Button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="space-y-3">
				<div>
					<h2 className="font-semibold text-base">Inbound webhooks</h2>
					<p className="text-muted-foreground text-sm">
						Point your payment provider at the per-project URL and sign the raw
						body with the project&apos;s HMAC secret.
					</p>
				</div>
				{projects.map((project) => {
					const info = webhook[project.id];
					return (
						<div key={project.id} className="rounded-md border p-3 text-sm">
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium">{project.name}</span>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => onReveal(project)}
									>
										Reveal
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={() => onRotate(project)}
									>
										Rotate
									</Button>
								</div>
							</div>
							<div className="mt-2 space-y-1 break-all font-mono text-[11px]">
								<div>
									<span className="text-muted-foreground">url: </span>
									{info?.url ?? `/webhooks/stripe/${project.id}`}
								</div>
								<div>
									<span className="text-muted-foreground">secret: </span>
									{info
										? (info.secret ?? "(none — rotate to create)")
										: project.hasWebhookSecret
											? "•••••••• (click Reveal)"
											: "(none — rotate to create)"}
								</div>
							</div>
						</div>
					);
				})}
			</section>
		</div>
	);
}
