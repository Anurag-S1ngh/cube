export const statusStyles: Record<string, string> = {
	received: "bg-muted text-muted-foreground",
	investigating: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	classified: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	recommended: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	actioned: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	escalated: "bg-red-500/15 text-red-600 dark:text-red-400",
	failed: "bg-red-500/15 text-red-600 dark:text-red-400",
	queued: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	sent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	blocked: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function statusClass(status: string): string {
	return statusStyles[status] ?? "bg-muted text-muted-foreground";
}

export const severityDot: Record<string, string> = {
	soft: "bg-amber-500",
	hard: "bg-orange-500",
	risk: "bg-red-500",
};
