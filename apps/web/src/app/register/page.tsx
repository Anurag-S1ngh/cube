import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@cube/ui/components/card";
import type { Route } from "next";
import Link from "next/link";

import { RegisterForm } from "@/components/register-form";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 py-12">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Create your account</CardTitle>
					<CardDescription>
						Start resolving failed payments in minutes.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<RegisterForm />
					<p className="text-muted-foreground text-sm">
						Already have an account?{" "}
						<Link
							href={"/login" as Route}
							className="text-foreground underline underline-offset-4"
						>
							Sign in
						</Link>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
