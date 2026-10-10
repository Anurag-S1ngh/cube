import { randomBytes } from "node:crypto";

/** Generate a per-project webhook signing secret (Stripe-style `whsec_...`). */
export function generateWebhookSecret(): string {
	return `whsec_${randomBytes(24).toString("base64url")}`;
}
