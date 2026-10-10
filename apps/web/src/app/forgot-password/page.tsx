import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@cube/ui/components/card";
import type { Route } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 py-12">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Reset your password</CardTitle>
					<CardDescription>
						We&apos;ll email you a link to choose a new one.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<ForgotPasswordForm />
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
