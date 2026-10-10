import { Card, CardHeader, CardTitle } from "@cube/ui/components/card";
import Link from "next/link";

import { SimulateButton } from "@/components/simulate-button";
import {
	formatMoney,
	getInvestigations,
	getSummary,
	type InvestigationListItem,
	type Summary,
} from "@/lib/api";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
	received: "bg-muted text-muted-foreground",
	investigating: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	classified: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	recommended: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	actioned: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	escalated: "bg-red-500/15 text-red-600 dark:text-red-400",
	failed: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const severityDot: Record<string, string> = {
	soft: "bg-amber-500",
	hard: "bg-orange-500",
	risk: "bg-red-500",
};

function StatusBadge({ status }: { status: string }) {
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[11px] capitalize ${
				statusStyles[status] ?? "bg-muted text-muted-foreground"
			}`}
		>
			{status}
		</span>
	);
}

function Kpi({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<Card size="sm">
			<CardHeader>
				<div className="text-[11px] text-muted-foreground uppercase tracking-wide">
					{label}
				</div>
				<CardTitle className="font-semibold text-2xl">{value}</CardTitle>
				{hint ? (
					<div className="text-[11px] text-muted-foreground">{hint}</div>
				) : null}
			</CardHeader>
		</Card>
	);
}

function Table({ rows }: { rows: InvestigationListItem[] }) {
	if (rows.length === 0) {
		return (
			<div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
				No investigations yet. Click “Simulate failed payments”.
			</div>
		);
	}
	return (
		<div className="overflow-x-auto rounded-md border">
			<table className="w-full text-left text-sm">
				<thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
					<tr>
						<th className="px-3 py-2 font-medium">Customer</th>
						<th className="px-3 py-2 font-medium">Amount</th>
						<th className="px-3 py-2 font-medium">Decline</th>
						<th className="px-3 py-2 font-medium">Cause</th>
						<th className="px-3 py-2 font-medium">Status</th>
						<th className="px-3 py-2 font-medium">Signals</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.id} className="border-t hover:bg-muted/30">
							<td className="px-3 py-2">
								<Link
									href={`/investigations/${row.id}`}
									className="font-medium hover:underline"
								>
									{row.customerName ?? row.customerEmail ?? "Unknown"}
								</Link>
								<div className="text-[11px] text-muted-foreground">
									{row.customerEmail}
								</div>
							</td>
							<td className="px-3 py-2 tabular-nums">
								{formatMoney(row.amountCents, row.currency)}
							</td>
							<td className="px-3 py-2 font-mono text-[11px]">
								{row.declineCode}
							</td>
							<td className="px-3 py-2">
								{row.causeCode ? (
									<span className="inline-flex items-center gap-1.5">
										<span
											className={`size-2 rounded-full ${
												severityDot[row.severity ?? ""] ?? "bg-muted-foreground"
											}`}
										/>
										<span>{row.causeCode}</span>
										{row.confidence != null ? (
											<span className="text-[11px] text-muted-foreground">
												{row.confidence}%
											</span>
										) : null}
									</span>
								) : (
									<span className="text-muted-foreground">—</span>
								)}
							</td>
							<td className="px-3 py-2">
								<StatusBadge status={row.status} />
							</td>
							<td className="px-3 py-2 text-[11px] text-muted-foreground">
								{row.neatlogsTraceId ? (
									<span title={row.neatlogsTraceId} className="mr-2">
										◉ trace
									</span>
								) : null}
								{row.cfoScenarioRef ? (
									<span title={row.cfoScenarioRef}>◆ cfo</span>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default async function Home() {
	let summary: Summary | null = null;
	let rows: InvestigationListItem[] = [];
	let error: string | null = null;

	try {
		[summary, rows] = await Promise.all([getSummary(), getInvestigations()]);
	} catch (err) {
		error = err instanceof Error ? err.message : "failed to load";
	}

	return (
		<main className="container mx-auto max-w-6xl px-4 py-6">
			<div className="mb-6 flex items-center justify-between gap-4">
				<div>
					<h1 className="font-semibold text-lg">Payment Failure Agent</h1>
					<p className="text-muted-foreground text-sm">
						Investigates failed payments, finds the probable cause, recommends a
						mitigation and follows up with the customer.
					</p>
				</div>
				<SimulateButton />
			</div>

			{error ? (
				<div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm">
					<div className="font-medium text-red-600 dark:text-red-400">
						Could not reach the API
					</div>
					<div className="mt-1 text-muted-foreground">{error}</div>
					<div className="mt-1 text-muted-foreground">
						Start it with <code>bun run dev:server</code>.
					</div>
				</div>
			) : (
				<>
					<div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
						<Kpi label="Investigations" value={String(summary?.total ?? 0)} />
						<Kpi
							label="Revenue at risk"
							value={formatMoney(summary?.revenueAtRiskCents ?? 0)}
						/>
						<Kpi
							label="Emails sent"
							value={String(summary?.emailsSent ?? 0)}
							hint={
								summary?.emailsBlocked
									? `${summary.emailsBlocked} blocked by guardrails`
									: undefined
							}
						/>
						<Kpi
							label="Escalated"
							value={String(summary?.byStatus.escalated ?? 0)}
						/>
					</div>
					<Table rows={rows} />
				</>
			)}
		</main>
	);
}
