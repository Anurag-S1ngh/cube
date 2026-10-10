import { Card, CardHeader, CardTitle } from "@cube/ui/components/card";

import { InvestigationsTable } from "@/components/investigations-table";
import { LiveRefresh } from "@/components/live-refresh";
import { SimulateButton } from "@/components/simulate-button";
import {
	formatMoney,
	getInvestigations,
	getSummary,
	type InvestigationListItem,
	type Summary,
} from "@/lib/api";

export const dynamic = "force-dynamic";

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
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="font-semibold text-lg">Payment Failure Agent</h1>
					<p className="text-muted-foreground text-sm">
						Investigates failed payments, finds the probable cause, recommends a
						mitigation and follows up with the customer.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<LiveRefresh />
					<SimulateButton />
				</div>
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
					<InvestigationsTable rows={rows} />
				</>
			)}
		</main>
	);
}
