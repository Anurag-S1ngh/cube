import { statusClass } from "@/lib/status";

export function StatusBadge({
	status,
	className,
}: {
	status: string;
	className?: string;
}) {
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[11px] capitalize ${statusClass(
				status,
			)} ${className ?? ""}`}
		>
			{status}
		</span>
	);
}
