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

import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 py-12">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Sign in</CardTitle>
					<CardDescription>Payment Failure Agent dashboard</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Suspense fallback={null}>
						<LoginForm />
					</Suspense>
					<p className="text-muted-foreground text-sm">
						No account?{" "}
						<Link
							href={"/register" as Route}
							className="text-foreground underline underline-offset-4"
						>
							Create one
						</Link>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
