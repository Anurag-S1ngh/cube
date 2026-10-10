import {
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { users } from "./billing";

// ---------------------------------------------------------------------------
// Dashboard auth: opaque session tokens. The raw token only ever lives in the
// user's httpOnly cookie; the database stores a SHA-256 hash of it.
// ---------------------------------------------------------------------------
export const sessions = pgTable(
	"sessions",
	{
		id: uuid().defaultRandom().primaryKey(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		userAgent: text("user_agent"),
		ip: text("ip"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("sessions_token_hash_key").on(table.tokenHash),
		index("sessions_user_idx").on(table.userId),
	],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
