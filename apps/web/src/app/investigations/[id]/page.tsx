import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@cube/ui/components/card";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
	formatMoney,
	getInvestigation,
	type InvestigationDetail,
} from "@/lib/api";
import {
	cfoScenarioUrl,
	entireCheckpointUrl,
	neatlogsTraceUrl,
} from "@/lib/links";

export const dynamic = "force-dynamic";

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description ? <CardDescription>{description}</CardDescription> : null}
			</CardHeader>
			<CardContent className="text-sm">{children}</CardContent>
		</Card>
	);
}

function RecordLink({
	label,
	value,
	href,
}: {
	label: string;
	value: string | null;
	href: string | null;
}) {
	return (
		<div className="flex items-center justify-between gap-3 border-t py-2 first:border-t-0">
			<span className="text-muted-foreground">{label}</span>
			{value ? (
				href ? (
					<a
						href={href}
						target="_blank"
						rel="noreferrer"
						className="truncate font-mono text-[11px] hover:underline"
						title={value}
					>
						{value.slice(0, 28)}
						{value.length > 28 ? "…" : ""}
					</a>
				) : (
					<span
						className="truncate font-mono text-[11px] text-muted-foreground"
						title={value}
					>
						{value.slice(0, 28)}
						{value.length > 28 ? "…" : ""}
					</span>
				)
			) : (
				<span className="text-[11px] text-muted-foreground">not recorded</span>
			)}
		</div>
	);
}

function Detail({ data }: { data: InvestigationDetail }) {
	const { investigation, customer, event, cause, recommendation } = data;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<Link
						href="/"
						className="text-muted-foreground text-xs hover:underline"
					>
						← Back to investigations
					</Link>
					<h1 className="font-semibold text-lg">
						{customer.name ?? customer.email ?? customer.externalId}
					</h1>
					<p className="text-muted-foreground text-sm">
						{formatMoney(event.amountCents, event.currency)} · invoice{" "}
						{event.invoiceNumber ?? "—"} · attempt {event.attemptNumber} ·{" "}
						<span className="font-mono">{event.declineCode}</span>
					</p>
				</div>
				<span className="rounded-full bg-muted px-3 py-1 font-medium text-xs capitalize">
					{investigation.status}
				</span>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<div className="space-y-4 lg:col-span-2">
					<Section
						title="Probable cause"
						description="Deterministically classified from the decline code and customer history."
					>
						{cause ? (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<span className="font-medium">{cause.label}</span>
									<span className="rounded bg-muted px-2 py-0.5 text-[11px] capitalize">
										{cause.severity}
									</span>
									<span className="text-[11px] text-muted-foreground">
										{cause.confidence}% confidence
									</span>
								</div>
								<pre className="overflow-x-auto rounded bg-muted/40 p-3 text-[11px] leading-relaxed">
									{JSON.stringify(cause.evidence, null, 2)}
								</pre>
							</div>
						) : (
							<span className="text-muted-foreground">Not classified yet.</span>
						)}
					</Section>

					<Section
						title="Recommended mitigation"
						description="Actions the agent executed or scheduled."
					>
						{recommendation ? (
							<div className="space-y-3">
								<div className="font-medium">{recommendation.summary}</div>
								<p className="text-muted-foreground">
									{recommendation.rationale}
								</p>
								<ul className="space-y-1.5">
									{recommendation.actions.map((action, i) => (
										<li key={i} className="flex items-start gap-2">
											<span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
												{action.type}
											</span>
											<span>{action.description}</span>
										</li>
									))}
								</ul>
							</div>
						) : (
							<span className="text-muted-foreground">
								No recommendation yet.
							</span>
						)}
					</Section>

					<Section
						title="Customer email"
						description="Sent automatically after the guardrail passed."
					>
						{data.emails.length === 0 ? (
							<span className="text-muted-foreground">
								No email — this case is a silent retry or a risk escalation.
							</span>
						) : (
							data.emails.map((email) => (
								<div key={email.id} className="space-y-2">
									<div className="flex flex-wrap items-center gap-2 text-xs">
										<span
											className={`rounded-full px-2 py-0.5 font-medium ${
												email.status === "sent"
													? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
													: "bg-red-500/15 text-red-600 dark:text-red-400"
											}`}
										>
											{email.status}
										</span>
										<span className="font-mono text-[11px]">
											{email.templateId}
										</span>
										<span className="text-muted-foreground">to {email.to}</span>
										{email.providerMessageId ? (
											<span className="text-muted-foreground">
												· {email.providerMessageId.slice(0, 18)}
											</span>
										) : null}
									</div>
									{email.blockReason ? (
										<div className="text-[11px] text-red-600 dark:text-red-400">
											Blocked: {email.blockReason}
										</div>
									) : null}
									<div className="font-medium">{email.subject}</div>
									<pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-[11px] leading-relaxed">
										{email.body}
									</pre>
								</div>
							))
						)}
					</Section>

					<Section
						title="Audit timeline"
						description="Every decision the agent recorded."
					>
						<ol className="space-y-2">
							{data.timeline.map((entry) => (
								<li key={entry.id} className="flex items-start gap-3">
									<span className="mt-1 size-1.5 shrink-0 rounded-full bg-foreground/40" />
									<div>
										<div className="flex items-center gap-2">
											<span className="font-mono text-[11px]">
												{entry.action}
											</span>
											<span className="text-[11px] text-muted-foreground">
												{new Date(entry.at).toLocaleString()}
											</span>
										</div>
										<div className="text-[11px] text-muted-foreground">
											{entry.actor} ·{" "}
											{JSON.stringify(entry.payload).slice(0, 140)}
										</div>
									</div>
								</li>
							))}
						</ol>
					</Section>
				</div>

				<div className="space-y-4">
					<Section
						title="Financial context"
						description="Deterministic figures from cfo.ai (or the ledger fallback)."
					>
						<div className="space-y-1">
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Outstanding</span>
								<span className="tabular-nums">
									{formatMoney(investigation.outstandingBalanceCents)}
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Revenue at risk</span>
								<span className="tabular-nums">
									{formatMoney(investigation.revenueAtRiskCents)}
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Recoverable</span>
								<span className="tabular-nums">
									{formatMoney(recommendation?.cashImpactCents ?? null)}
								</span>
							</div>
							{data.scenarios[0] ? (
								<div className="mt-2 rounded bg-muted/40 p-2 text-[11px]">
									Scenario{" "}
									<span className="font-mono">{data.scenarios[0].kind}</span>{" "}
									projects {formatMoney(data.scenarios[0].projectedInflowCents)}{" "}
									inflow.
								</div>
							) : null}
						</div>
					</Section>

					<Section
						title="Systems of record"
						description="Each investigation links to the three tools behind it."
					>
						<RecordLink
							label="neatlogs trace"
							value={investigation.neatlogsTraceId}
							href={neatlogsTraceUrl(investigation.neatlogsTraceId)}
						/>
						<RecordLink
							label="cfo.ai scenario"
							value={investigation.cfoScenarioRef}
							href={cfoScenarioUrl(investigation.cfoScenarioRef)}
						/>
						<RecordLink
							label="entire.io checkpoint"
							value={investigation.entireCheckpointId}
							href={entireCheckpointUrl(investigation.entireCheckpointId)}
						/>
					</Section>

					{data.runs[0] ? (
						<Section
							title="Agent run"
							description="Runtime metrics for this investigation."
						>
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Latency</span>
								<span className="tabular-nums">
									{data.runs[0].latencyMs} ms
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Model</span>
								<span className="font-mono text-[11px]">
									{data.runs[0].model ?? "deterministic"}
								</span>
							</div>
						</Section>
					) : null}
				</div>
			</div>
		</div>
	);
}

export default async function InvestigationPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	try {
		const data = await getInvestigation(id);
		return (
			<main className="container mx-auto max-w-6xl px-4 py-6">
				<Detail data={data} />
			</main>
		);
	} catch {
		notFound();
	}
}
