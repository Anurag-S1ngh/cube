"use client";

import { Button } from "@cube/ui/components/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getMe, logout, type SessionUser } from "@/lib/auth-client";

export function UserMenu() {
	const router = useRouter();
	const [user, setUser] = useState<SessionUser | null>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let active = true;
		getMe()
			.then((me) => {
				if (active) setUser(me?.user ?? null);
			})
			.catch(() => undefined)
			.finally(() => {
				if (active) setLoaded(true);
			});
		return () => {
			active = false;
		};
	}, []);

	if (!loaded || !user) return null;

	async function signOut() {
		try {
			await logout();
		} finally {
			router.replace("/login");
			router.refresh();
		}
	}

	return (
		<div className="flex items-center gap-2">
			<span className="hidden text-muted-foreground text-xs sm:inline">
				{user.email}
			</span>
			<Button variant="outline" size="sm" onClick={signOut}>
				Sign out
			</Button>
		</div>
	);
}
