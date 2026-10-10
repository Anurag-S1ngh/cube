"use client";

import { Button } from "@cube/ui/components/button";
import { useEffect } from "react";

export default function RouteError({
	error: err,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(err);
	}, [err]);

	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<div className="font-semibold text-lg">Something went wrong</div>
			<p className="max-w-md text-muted-foreground text-sm">{err.message}</p>
			<Button size="sm" onClick={reset}>
				Try again
			</Button>
		</div>
	);
}
