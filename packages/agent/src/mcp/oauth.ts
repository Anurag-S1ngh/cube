import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";

export type StoredTokens = {
	access_token: string;
	refresh_token?: string;
	/** Epoch ms at which the access token expires. */
	expires_at?: number;
	token_endpoint: string;
	client_id: string;
	client_secret?: string;
	scope?: string;
};

export type OAuthConfig = {
	/** The MCP resource URL, e.g. https://api.cfo.ai/mcp */
	mcpUrl: string;
	credentialsPath: string;
	redirectPort?: number;
	scope?: string;
	timeoutMs?: number;
};

type AsMeta = {
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	scopes_supported?: string[];
};

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
};

const DEFAULT_PORT = 19876;
const CLIENT_NAME = "cube-payment-agent";

function b64url(input: Buffer | string): string {
	const buf = typeof input === "string" ? Buffer.from(input) : input;
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

async function fetchJson(
	url: string,
	init?: RequestInit,
): Promise<Record<string, unknown> | null> {
	try {
		const res = await fetch(url, init);
		if (!res.ok) return null;
		return (await res.json()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function loadTokens(path: string): Promise<StoredTokens | null> {
	try {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw) as StoredTokens;
	} catch {
		return null;
	}
}

export async function saveTokens(
	path: string,
	tokens: StoredTokens,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

/** Discover the authorization server metadata (RFC 9728 + RFC 8414). */
async function discoverMetadata(mcpUrl: string): Promise<AsMeta> {
	const url = new URL(mcpUrl);
	const prmCandidates = [
		`${url.origin}/.well-known/oauth-protected-resource${url.pathname}`,
		`${url.origin}/.well-known/oauth-protected-resource`,
	];

	let authServers: string[] = [];
	for (const candidate of prmCandidates) {
		const meta = await fetchJson(candidate);
		if (!meta) continue;
		const servers = meta.authorization_servers;
		if (Array.isArray(servers) && servers.length > 0) {
			authServers = servers.filter((s): s is string => typeof s === "string");
			break;
		}
	}
	if (authServers.length === 0) authServers = [url.origin];

	for (const issuer of authServers) {
		const base = issuer.replace(/\/$/, "");
		for (const path of [
			`${base}/.well-known/oauth-authorization-server`,
			`${base}/.well-known/openid-configuration`,
		]) {
			const meta = await fetchJson(path);
			if (
				meta &&
				typeof meta.authorization_endpoint === "string" &&
				typeof meta.token_endpoint === "string"
			) {
				return {
					authorization_endpoint: meta.authorization_endpoint,
					token_endpoint: meta.token_endpoint,
					registration_endpoint:
						typeof meta.registration_endpoint === "string"
							? meta.registration_endpoint
							: undefined,
					scopes_supported: Array.isArray(meta.scopes_supported)
						? (meta.scopes_supported as string[])
						: undefined,
				};
			}
		}
	}

	throw new Error(`could not discover OAuth metadata for ${mcpUrl}`);
}

async function registerClient(
	meta: AsMeta,
	redirectUri: string,
	scope?: string,
): Promise<{ client_id: string; client_secret?: string }> {
	if (!meta.registration_endpoint) {
		throw new Error(
			"authorization server has no dynamic registration endpoint",
		);
	}
	const body = {
		client_name: CLIENT_NAME,
		redirect_uris: [redirectUri],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
		...(scope ? { scope } : {}),
	};
	const res = await fetch(meta.registration_endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`dynamic client registration failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
		);
	}
	const data = (await res.json()) as {
		client_id?: string;
		client_secret?: string;
	};
	if (!data.client_id)
		throw new Error("registration response missing client_id");
	return { client_id: data.client_id, client_secret: data.client_secret };
}

function openBrowser(url: string): void {
	const platform = process.platform;
	const cmd =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args = platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
	} catch {
		// best effort; the URL is also printed for manual opening
	}
}

function waitForCode(
	port: number,
	expectedState: string,
	authUrl: string,
	timeoutMs: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
			if (requestUrl.pathname !== "/mcp/oauth/callback") {
				res.statusCode = 404;
				res.end("not found");
				return;
			}
			const code = requestUrl.searchParams.get("code");
			const state = requestUrl.searchParams.get("state");
			const error = requestUrl.searchParams.get("error");
			res.setHeader("content-type", "text/html");
			if (error) {
				res.end(`<h2>Authorization failed: ${error}</h2>`);
				server.close();
				reject(new Error(`authorization failed: ${error}`));
				return;
			}
			if (!code || state !== expectedState) {
				res.end("<h2>Invalid authorization response.</h2>");
				server.close();
				reject(new Error("invalid authorization response"));
				return;
			}
			res.end(
				"<h2>cfo.ai connected.</h2><p>You can close this window and return to the terminal.</p>",
			);
			server.close();
			resolve(code);
		});

		const timer = setTimeout(() => {
			server.close();
			reject(new Error("timed out waiting for authorization"));
		}, timeoutMs);

		server.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		server.listen(port, "127.0.0.1", () => {
			console.log(`\nOpen this URL to authorize cfo.ai:\n${authUrl}\n`);
			openBrowser(authUrl);
		});
	});
}

async function exchangeCode(
	tokenEndpoint: string,
	params: {
		code: string;
		verifier: string;
		clientId: string;
		clientSecret?: string;
		redirectUri: string;
		resource: string;
	},
): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: params.redirectUri,
		client_id: params.clientId,
		code_verifier: params.verifier,
		resource: params.resource,
	});
	if (params.clientSecret) body.set("client_secret", params.clientSecret);
	const res = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`token exchange failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
		);
	}
	return (await res.json()) as TokenResponse;
}

async function refreshTokens(
	tokenEndpoint: string,
	refreshToken: string,
	clientId: string,
	clientSecret: string | undefined,
	resource: string,
): Promise<TokenResponse | null> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: clientId,
		resource,
	});
	if (clientSecret) body.set("client_secret", clientSecret);
	const res = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) return null;
	return (await res.json()) as TokenResponse;
}

/**
 * Run the interactive OAuth flow once and persist tokens. Prints the
 * authorization URL and opens the browser; the user approves while signed in
 * to cfo.ai and the local callback captures the code.
 */
export async function login(config: OAuthConfig): Promise<StoredTokens> {
	const meta = await discoverMetadata(config.mcpUrl);
	const port = config.redirectPort ?? DEFAULT_PORT;
	const redirectUri = `http://127.0.0.1:${port}/mcp/oauth/callback`;
	const scope = config.scope ?? (meta.scopes_supported?.join(" ") || undefined);

	const existing = await loadTokens(config.credentialsPath);
	const client = existing?.client_id
		? { client_id: existing.client_id, client_secret: existing.client_secret }
		: await registerClient(meta, redirectUri, scope);

	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash("sha256").update(verifier).digest());
	const state = b64url(randomBytes(16));

	const authUrl = new URL(meta.authorization_endpoint);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("client_id", client.client_id);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("code_challenge", challenge);
	authUrl.searchParams.set("code_challenge_method", "S256");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("resource", config.mcpUrl);
	if (scope) authUrl.searchParams.set("scope", scope);

	const code = await waitForCode(
		port,
		state,
		authUrl.toString(),
		config.timeoutMs ?? 300_000,
	);

	const tokens = await exchangeCode(meta.token_endpoint, {
		code,
		verifier,
		clientId: client.client_id,
		clientSecret: client.client_secret,
		redirectUri,
		resource: config.mcpUrl,
	});

	const stored: StoredTokens = {
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token,
		expires_at: tokens.expires_in
			? Date.now() + tokens.expires_in * 1000
			: undefined,
		token_endpoint: meta.token_endpoint,
		client_id: client.client_id,
		client_secret: client.client_secret,
		scope,
	};
	await saveTokens(config.credentialsPath, stored);
	return stored;
}

/**
 * Return a valid access token, refreshing if needed. Returns null when there
 * are no stored credentials (the caller then falls back to the ledger) or the
 * refresh fails (the user must run the login command again).
 */
export async function getAccessToken(
	config: OAuthConfig,
): Promise<string | null> {
	const stored = await loadTokens(config.credentialsPath);
	if (!stored) return null;

	if (stored.expires_at && Date.now() < stored.expires_at - 60_000) {
		return stored.access_token;
	}
	if (!stored.refresh_token) return null;

	const refreshed = await refreshTokens(
		stored.token_endpoint,
		stored.refresh_token,
		stored.client_id,
		stored.client_secret,
		config.mcpUrl,
	);
	if (!refreshed) return null;

	const next: StoredTokens = {
		...stored,
		access_token: refreshed.access_token,
		refresh_token: refreshed.refresh_token ?? stored.refresh_token,
		expires_at: refreshed.expires_in
			? Date.now() + refreshed.expires_in * 1000
			: stored.expires_at,
	};
	await saveTokens(config.credentialsPath, next);
	return next.access_token;
}
