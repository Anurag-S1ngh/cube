import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@cube/ui/components/card";
import type { Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 py-12">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Choose a new password</CardTitle>
					<CardDescription>
						Setting a new password signs you out everywhere.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Suspense fallback={null}>
						<ResetPasswordForm />
					</Suspense>
					<p className="text-muted-foreground text-sm">
						<Link
							href={"/login" as Route}
							className="text-foreground underline underline-offset-4"
						>
							Back to sign in
						</Link>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
