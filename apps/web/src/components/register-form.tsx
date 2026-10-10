"use client";

import { Button } from "@cube/ui/components/button";
import { Input } from "@cube/ui/components/input";
import { Label } from "@cube/ui/components/label";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { register } from "@/lib/auth-client";

export function RegisterForm() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [projectName, setProjectName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			await register({
				email,
				password,
				name: name || undefined,
				projectName: projectName || undefined,
			});
			router.replace("/");
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "sign up failed");
			setPending(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="name">Name</Label>
				<Input
					id="name"
					name="name"
					autoComplete="name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Ada Lovelace"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="email">Work email</Label>
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
					autoComplete="new-password"
					required
					minLength={8}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="At least 8 characters"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="projectName">Workspace name</Label>
				<Input
					id="projectName"
					name="projectName"
					value={projectName}
					onChange={(event) => setProjectName(event.target.value)}
					placeholder="Acme billing"
				/>
			</div>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button type="submit" disabled={pending}>
				{pending ? "Creating account…" : "Create account"}
			</Button>
		</form>
	);
}
