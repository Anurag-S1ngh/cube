"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { Label } from "@cube/ui/components/label";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { login } from "@/lib/auth-client";

export function LoginForm() {
	const router = useRouter();
	const params = useSearchParams();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			await login(email, password);
			const next = params.get("next");
			const target = next?.startsWith("/") ? next : "/";
			router.replace(target as Route);
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "sign in failed");
			setPending(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="email">Email</Label>
				<Input
					id="email"
					name="email"
					type="email"
					autoComplete="username"
					required
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="you@company.com"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="password">Password</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autoComplete="current-password"
					required
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
			</div>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button type="submit" disabled={pending}>
				{pending ? "Signing in…" : "Sign in"}
			</Button>
		</form>
	);
}
