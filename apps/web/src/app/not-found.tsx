import { Button } from "@cube/ui/components/button";
import Link from "next/link";

export default function NotFound() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<div className="font-semibold text-lg">Not found</div>
			<p className="text-muted-foreground text-sm">
				We couldn&apos;t find that investigation.
			</p>
			<Button size="sm" render={<Link href="/" />}>
				Back to investigations
			</Button>
		</div>
	);
}
