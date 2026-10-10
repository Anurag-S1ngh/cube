import type { Database } from "@cube/db";
import { investigations } from "@cube/db";
import { inArray } from "drizzle-orm";

import { runInvestigation } from "./pipeline";
import type { AgentConfig } from "./types";

export type InvestigationQueue = {
	enqueue(investigationId: string): void;
	/** Re-enqueue anything left mid-flight (e.g. after a restart). */
	recover(): Promise<number>;
	/** Resolve when the queue has fully drained. */
	idle(): Promise<void>;
	size(): number;
};

type QueueOptions = {
	db: Database;
	config: AgentConfig;
	maxAttempts?: number;
	onError?: (investigationId: string, error: unknown) => void;
};

/**
 * A small in-process work queue with bounded retries and exponential backoff.
 * Kept dependency-free on purpose; the durable state lives in `investigations`
 * so `recover()` can resume after a crash.
 */
export function createInvestigationQueue({
	db,
	config,
	maxAttempts = 3,
	onError,
}: QueueOptions): InvestigationQueue {
	const queue: string[] = [];
	const attempts = new Map<string, number>();
	const waiters: (() => void)[] = [];
	let running = false;

	function notifyIdle(): void {
		const pending = waiters.splice(0);
		for (const resolve of pending) resolve();
	}

	function enqueue(investigationId: string): void {
		if (!queue.includes(investigationId)) {
			queue.push(investigationId);
		}
		void drain();
	}

	async function drain(): Promise<void> {
		if (running) return;
		running = true;
		try {
			while (queue.length > 0) {
				const id = queue.shift();
				if (!id) break;
				try {
					await runInvestigation(db, config, id);
					attempts.delete(id);
				} catch (error) {
					const attempt = (attempts.get(id) ?? 0) + 1;
					if (attempt < maxAttempts) {
						attempts.set(id, attempt);
						const delayMs = 2 ** attempt * 250;
						setTimeout(() => enqueue(id), delayMs);
					} else {
						attempts.delete(id);
						onError?.(id, error);
					}
				}
			}
		} finally {
			running = false;
			notifyIdle();
		}
	}

	async function recover(): Promise<number> {
		const rows = await db
			.select({ id: investigations.id })
			.from(investigations)
			.where(inArray(investigations.status, ["received", "failed"]));
		for (const row of rows) enqueue(row.id);
		return rows.length;
	}

	async function idle(): Promise<void> {
		if (!running && queue.length === 0) return;
		await new Promise<void>((resolve) => waiters.push(resolve));
	}

	return {
		enqueue,
		recover,
		idle,
		size: () => queue.length,
	};
}
