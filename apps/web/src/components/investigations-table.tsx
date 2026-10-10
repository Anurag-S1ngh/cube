"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { formatMoney, type InvestigationListItem } from "@/lib/api";

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

const PAGE_SIZE = 10;

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

const selectClass =
	"h-8 rounded-md border bg-transparent px-2 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-ring";

export function InvestigationsTable({
	rows,
}: {
	rows: InvestigationListItem[];
}) {
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState("all");
	const [severity, setSeverity] = useState("all");
	const [page, setPage] = useState(0);

	const statuses = useMemo(
		() => Array.from(new Set(rows.map((r) => r.status))).sort(),
		[rows],
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return rows.filter((row) => {
			if (status !== "all" && row.status !== status) return false;
			if (severity !== "all" && row.severity !== severity) return false;
			if (!q) return true;
			return [
				row.customerName,
				row.customerEmail,
				row.declineCode,
				row.causeCode,
			]
				.filter(Boolean)
				.some((value) => value?.toLowerCase().includes(q));
		});
	}, [rows, query, status, severity]);

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const visible = filtered.slice(
		currentPage * PAGE_SIZE,
		currentPage * PAGE_SIZE + PAGE_SIZE,
	);

	function reset<T>(setter: (value: T) => void, value: T) {
		setter(value);
		setPage(0);
	}

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-56 flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(e) => reset(setQuery, e.target.value)}
						placeholder="Search customer, decline or cause…"
						className="h-8 pl-8 text-sm"
					/>
				</div>
				<select
					value={status}
					onChange={(e) => reset(setStatus, e.target.value)}
					className={selectClass}
					aria-label="Filter by status"
				>
					<option value="all">All statuses</option>
					{statuses.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<select
					value={severity}
					onChange={(e) => reset(setSeverity, e.target.value)}
					className={selectClass}
					aria-label="Filter by severity"
				>
					<option value="all">All severities</option>
					<option value="soft">soft</option>
					<option value="hard">hard</option>
					<option value="risk">risk</option>
				</select>
				<span className="text-muted-foreground text-xs">
					{filtered.length} of {rows.length}
				</span>
			</div>

			{visible.length === 0 ? (
				<div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
					No investigations match these filters.
				</div>
			) : (
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
							{visible.map((row) => (
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
														severityDot[row.severity ?? ""] ??
														"bg-muted-foreground"
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
			)}

			{pageCount > 1 ? (
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground text-xs">
						Page {currentPage + 1} of {pageCount}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage === 0}
							onClick={() => setPage((p) => Math.max(0, p - 1))}
						>
							<ChevronLeft className="size-3.5" /> Prev
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage >= pageCount - 1}
							onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
						>
							Next <ChevronRight className="size-3.5" />
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
