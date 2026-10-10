"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { ArrowDownAZ, ArrowUpAZ, Search } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { severityDot } from "@/lib/status";
import { formatMoney, type InvestigationListItem } from "@/lib/types";

const STATUSES = [
	"received",
	"investigating",
	"classified",
	"recommended",
	"actioned",
	"escalated",
	"resolved",
	"failed",
];

const SORTS = [
	{ value: "createdAt", label: "Newest" },
	{ value: "amount", label: "Amount" },
	{ value: "confidence", label: "Confidence" },
];

export type InvestigationFilters = {
	q: string;
	status: string;
	severity: string;
	sort: string;
	order: "asc" | "desc";
};

const selectClass =
	"h-8 rounded-md border bg-transparent px-2 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-ring";

export function InvestigationsTable({
	rows,
	total,
	page,
	pageSize,
	filters,
}: {
	rows: InvestigationListItem[];
	total: number;
	page: number;
	pageSize: number;
	filters: InvestigationFilters;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const [query, setQuery] = useState(filters.q);

	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const filtered =
		filters.q !== "" ||
		filters.status !== "" ||
		filters.severity !== "" ||
		filters.sort !== "createdAt" ||
		filters.order !== "desc";

	// Filters live in the URL so they survive refresh, back/forward and sharing.
	function apply(
		next: Partial<InvestigationFilters> & { page?: number },
	): void {
		const merged = { ...filters, ...next };
		const targetPage = next.page ?? 1;
		const params = new URLSearchParams();
		if (merged.q) params.set("q", merged.q);
		if (merged.status && merged.status !== "all")
			params.set("status", merged.status);
		if (merged.severity && merged.severity !== "all")
			params.set("severity", merged.severity);
		if (merged.sort && merged.sort !== "createdAt")
			params.set("sort", merged.sort);
		if (merged.order && merged.order !== "desc")
			params.set("order", merged.order);
		if (targetPage > 1) params.set("page", String(targetPage));
		const qs = params.toString();
		router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, {
			scroll: false,
		});
	}

	return (
		<div className="space-y-3">
			<form
				className="flex flex-wrap items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					apply({ q: query });
				}}
			>
				<div className="relative min-w-56 flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search customer, decline or cause… (Enter)"
						className="h-8 pl-8 text-sm"
						aria-label="Search investigations"
					/>
				</div>
				<select
					value={filters.status || "all"}
					onChange={(event) => apply({ status: event.target.value })}
					className={selectClass}
					aria-label="Filter by status"
				>
					<option value="all">All statuses</option>
					{STATUSES.map((status) => (
						<option key={status} value={status}>
							{status}
						</option>
					))}
				</select>
				<select
					value={filters.severity || "all"}
					onChange={(event) => apply({ severity: event.target.value })}
					className={selectClass}
					aria-label="Filter by severity"
				>
					<option value="all">All severities</option>
					<option value="soft">soft</option>
					<option value="hard">hard</option>
					<option value="risk">risk</option>
				</select>
				<select
					value={filters.sort || "createdAt"}
					onChange={(event) => apply({ sort: event.target.value })}
					className={selectClass}
					aria-label="Sort by"
				>
					{SORTS.map((sort) => (
						<option key={sort.value} value={sort.value}>
							{sort.label}
						</option>
					))}
				</select>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					aria-label={filters.order === "asc" ? "Ascending" : "Descending"}
					title={filters.order === "asc" ? "Ascending" : "Descending"}
					onClick={() =>
						apply({ order: filters.order === "asc" ? "desc" : "asc" })
					}
				>
					{filters.order === "asc" ? (
						<ArrowUpAZ className="size-3.5" />
					) : (
						<ArrowDownAZ className="size-3.5" />
					)}
				</Button>
				<span className="text-muted-foreground text-xs">
					{total} total
				</span>
			</form>

			{rows.length === 0 ? (
				<div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
					{filtered
						? "No investigations match these filters."
						: "No investigations yet. Use “Simulate failed payments” to generate some."}
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
						Page {page} of {pageCount}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => apply({ page: page - 1 })}
						>
							Prev
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= pageCount}
							onClick={() => apply({ page: page + 1 })}
						>
							Next
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
