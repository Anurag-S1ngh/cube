"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { Label } from "@cube/ui/components/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
	ApiError,
	createWebhookEndpoint,
	deleteWebhookEndpoint,
} from "@/lib/api-client";
import type { Project, WebhookEndpoint } from "@/lib/types";

export function WebhookEndpointsManager({
	projects,
	endpoints,
}: {
	projects: Project[];
	endpoints: WebhookEndpoint[];
}) {
	const router = useRouter();
	const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
	const [url, setUrl] = useState("");
	const [pending, setPending] = useState(false);
	const [reveal, setReveal] = useState<Record<string, boolean>>({});

	function handleError(error: unknown): void {
		if (error instanceof ApiError && error.status === 401) {
			router.replace("/login");
			return;
		}
		toast.error(error instanceof Error ? error.message : "action failed");
	}

	async function onCreate(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!projectId || !url) return;
		setPending(true);
		try {
			await createWebhookEndpoint(projectId, url.trim());
			toast.success("Endpoint created");
			setUrl("");
			router.refresh();
		} catch (error) {
			handleError(error);
		} finally {
			setPending(false);
		}
	}

	async function onDelete(id: string) {
		try {
			await deleteWebhookEndpoint(id);
			toast.success("Endpoint removed");
			router.refresh();
		} catch (error) {
			handleError(error);
		}
	}

	return (
		<section className="space-y-3">
			<div>
				<h2 className="font-semibold text-base">Outbound events</h2>
				<p className="text-muted-foreground text-sm">
					Cube POSTs signed lifecycle events (investigation created, actioned,
					escalated, resolved, emails) to your endpoints. Verify the{" "}
					<code className="text-[11px]">Cube-Signature</code> header with the
					shown secret.
				</p>
			</div>

			<form
				onSubmit={onCreate}
				className="flex flex-wrap items-end gap-2 rounded-md border p-3"
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="wh-project">Project</Label>
					<select
						id="wh-project"
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
				<div className="flex min-w-56 flex-1 flex-col gap-1.5">
					<Label htmlFor="wh-url">Endpoint URL</Label>
					<Input
						id="wh-url"
						type="url"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://api.yourapp.com/cube/webhooks"
					/>
				</div>
				<Button type="submit" disabled={pending || !projectId}>
					{pending ? "Adding…" : "Add endpoint"}
				</Button>
			</form>

			{endpoints.length === 0 ? (
				<p className="text-muted-foreground text-sm">No endpoints yet.</p>
			) : (
				<div className="space-y-2">
					{endpoints.map((endpoint) => {
						const project = projects.find((p) => p.id === endpoint.projectId);
						return (
							<div key={endpoint.id} className="rounded-md border p-3 text-sm">
								<div className="flex items-center justify-between gap-2">
									<div className="min-w-0">
										<div className="truncate font-medium">{endpoint.url}</div>
										<div className="text-[11px] text-muted-foreground">
											{project?.name ?? endpoint.projectId} ·{" "}
											{endpoint.events.length === 0
												? "all events"
												: `${endpoint.events.length} event(s)`}
										</div>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={() => onDelete(endpoint.id)}
									>
										Remove
									</Button>
								</div>
								<div className="mt-2 flex items-center gap-2 font-mono text-[11px]">
									<span className="text-muted-foreground">secret:</span>
									{reveal[endpoint.id] ? (
										<span className="break-all">{endpoint.secret}</span>
									) : (
										<span>••••••••••••</span>
									)}
									<Button
										variant="ghost"
										size="xs"
										onClick={() =>
											setReveal((prev) => ({
												...prev,
												[endpoint.id]: !prev[endpoint.id],
											}))
										}
									>
										{reveal[endpoint.id] ? "Hide" : "Reveal"}
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
