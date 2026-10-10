import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@cube/ui/components/card";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in · cube" };

export default function LoginPage() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 py-12">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Sign in</CardTitle>
					<CardDescription>Payment Failure Agent dashboard</CardDescription>
				</CardHeader>
				<CardContent>
					<Suspense fallback={null}>
						<LoginForm />
					</Suspense>
				</CardContent>
			</Card>
		</main>
	);
}
