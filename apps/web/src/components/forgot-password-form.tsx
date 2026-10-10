"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { Label } from "@cube/ui/components/label";
import { useState } from "react";

import { requestPasswordReset } from "@/lib/auth-client";

export function ForgotPasswordForm() {
	const [email, setEmail] = useState("");
	const [pending, setPending] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			await requestPasswordReset(email);
			setSent(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "request failed");
		} finally {
			setPending(false);
		}
	}

	if (sent) {
		return (
			<p className="text-sm">
				If an account exists for <strong>{email}</strong>, a reset link is on
				its way.
			</p>
		);
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
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button type="submit" disabled={pending}>
				{pending ? "Sending…" : "Send reset link"}
			</Button>
		</form>
	);
}
