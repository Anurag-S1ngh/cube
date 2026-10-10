"use client";

import { Button } from "@cube/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ApiError, approveEmail, rejectEmail } from "@/lib/api-client";

/**
 * Approve/reject controls for an email the agent queued for review. On success
 * the server component data is refreshed so the status updates in place.
 */
export function ReviewEmailActions({
	investigationId,
}: {
	investigationId: string;
}) {
	const router = useRouter();
	const [pending, setPending] = useState<"approve" | "reject" | null>(null);

	async function decide(kind: "approve" | "reject") {
		setPending(kind);
		try {
			if (kind === "approve") {
				await approveEmail(investigationId);
				toast.success("Email approved and sent");
			} else {
				await rejectEmail(investigationId);
				toast.success("Email rejected");
			}
			router.refresh();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				router.replace("/login");
				return;
			}
			toast.error(error instanceof Error ? error.message : "action failed");
		} finally {
			setPending(null);
		}
	}

	return (
		<div className="flex items-center gap-2">
			<Button
				size="sm"
				disabled={pending !== null}
				onClick={() => decide("approve")}
			>
				{pending === "approve" ? "Sending…" : "Approve & send"}
			</Button>
			<Button
				size="sm"
				variant="outline"
				disabled={pending !== null}
				onClick={() => decide("reject")}
			>
				{pending === "reject" ? "Rejecting…" : "Reject"}
			</Button>
		</div>
	);
}
