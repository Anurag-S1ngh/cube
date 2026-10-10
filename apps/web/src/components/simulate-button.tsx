"use client";

import { Button } from "@cube/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ApiError, simulateFailures } from "@/lib/api-client";

export function SimulateButton() {
	const router = useRouter();
	const [pending, setPending] = useState(false);

	async function run() {
		setPending(true);
		try {
			const data = await simulateFailures(6);
			toast.success(`Simulated ${data.created} failed payments`);
			router.refresh();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				router.replace("/login");
				return;
			}
			toast.error(error instanceof Error ? error.message : "simulation failed");
		} finally {
			setPending(false);
		}
	}

	return (
		<Button onClick={run} disabled={pending} size="sm">
			{pending ? "Simulating…" : "Simulate failed payments"}
		</Button>
	);
}
