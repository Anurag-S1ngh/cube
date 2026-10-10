"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { Label } from "@cube/ui/components/label";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { resetPassword } from "@/lib/auth-client";

export function ResetPasswordForm() {
	const router = useRouter();
	const params = useSearchParams();
	const token = params.get("token") ?? "";
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		if (password !== confirm) {
			setError("passwords do not match");
			return;
		}
		setPending(true);
		try {
			await resetPassword(token, password);
			router.replace("/login" as Route);
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "reset failed");
			setPending(false);
		}
	}

	if (!token) {
		return (
			<p className="text-destructive text-sm">
				This reset link is missing its token. Request a new one.
			</p>
		);
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="password">New password</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autoComplete="new-password"
					required
					minLength={8}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="At least 8 characters"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="confirm">Confirm password</Label>
				<Input
					id="confirm"
					name="confirm"
					type="password"
					autoComplete="new-password"
					required
					minLength={8}
					value={confirm}
					onChange={(event) => setConfirm(event.target.value)}
				/>
			</div>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button type="submit" disabled={pending}>
				{pending ? "Updating…" : "Set new password"}
			</Button>
		</form>
	);
}
