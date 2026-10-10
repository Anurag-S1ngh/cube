"use client";

import { Button } from "@cube/ui/components/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function LiveRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
	const router = useRouter();
	const [on, setOn] = useState(false);

	useEffect(() => {
		if (!on) return;
		const id = setInterval(() => router.refresh(), intervalMs);
		return () => clearInterval(id);
	}, [on, intervalMs, router]);

	return (
		<Button
			variant={on ? "default" : "outline"}
			size="sm"
			onClick={() => setOn((value) => !value)}
			title="Auto-refresh the board while the agent processes investigations"
		>
			<span
				className={`size-2 rounded-full ${
					on ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"
				}`}
			/>
			{on ? "Live" : "Live off"}
		</Button>
	);
}
