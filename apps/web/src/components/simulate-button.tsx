"use client";

import { Button } from "@cube/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SERVER_URL } from "@/lib/api";

export function SimulateButton() {
	const router = useRouter();
	const [pending, setPending] = useState(false);

	async function run() {
		setPending(true);
		try {
			const res = await fetch(`${SERVER_URL}/mock/simulate?count=6`, {
				method: "POST",
			});
			if (!res.ok) throw new Error(`simulate failed (${res.status})`);
			const data = (await res.json()) as { created: number };
			toast.success(`Simulated ${data.created} failed payments`);
			router.refresh();
		} catch (error) {
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
