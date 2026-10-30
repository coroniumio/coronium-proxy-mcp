import axios from "axios";
import {createHash} from "node:crypto";
import type {RemoteScope} from "./context.js";

// Bearer verification for the hosted server. The MCP service holds no database and
// no secrets: it asks the Coronium API who a bearer belongs to and forwards the same
// bearer upstream, where the API enforces scopes, spending and revocation again.

export const OAUTH_TOKEN_PREFIX = "cmcp_at_";
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 10_000;
const VERIFY_TIMEOUT_MS = 10_000;

export interface VerifiedBearer {
    auth: "oauth" | "api_token";
    connectionId: string;
    resource: string | null;
    scopes: RemoteScope[];
    spendingEnabled: boolean;
    expiresAt: number;
}

export type VerifyOutcome =
    | {ok: true; bearer: VerifiedBearer}
    | {ok: false; reason: "invalid_token" | "upstream_unavailable"};

const SCOPES: readonly RemoteScope[] = ["read", "manage", "spend"];

export function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        return payload && typeof payload === "object" ? payload : null;
    } catch {
        return null;
    }
}

// A raw dashboard API token (a JWT with kind "api") is accepted for API clients.
// The signature is checked by the API, not here. Login JWTs (no kind) are refused:
// they cannot be revoked and are not meant to leave the dashboard.
export function isDashboardApiToken(token: string): boolean {
    return decodeJwtPayload(token)?.kind === "api";
}

export class BearerVerifier {
    private cache = new Map<string, VerifiedBearer>();

    constructor(private readonly apiBaseUrl: string, private readonly now: () => number = Date.now) {}

    async verify(token: string): Promise<VerifyOutcome> {
        if (!/^[\x21-\x7e]{16,4096}$/.test(token)) return {ok: false, reason: "invalid_token"};
        const key = sha256(token);
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > this.now()) return {ok: true, bearer: cached};
        this.cache.delete(key);
        let outcome: VerifyOutcome;
        if (token.startsWith(OAUTH_TOKEN_PREFIX)) outcome = await this.verifyOAuth(token);
        else if (isDashboardApiToken(token)) outcome = await this.verifyApiToken(token, key);
        else return {ok: false, reason: "invalid_token"};
        if (outcome.ok) this.remember(key, outcome.bearer);
        return outcome;
    }

    private remember(key: string, bearer: VerifiedBearer): void {
        if (this.cache.size >= CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, {...bearer, expiresAt: Math.min(bearer.expiresAt, this.now() + CACHE_TTL_MS)});
    }

    private async get(path: string, token: string): Promise<{status: number; body: any} | null> {
        try {
            const response = await axios.get(this.apiBaseUrl + path, {
                headers: {Authorization: `Bearer ${token}`, Accept: "application/json"},
                timeout: VERIFY_TIMEOUT_MS, maxRedirects: 0, validateStatus: () => true, responseType: "json",
            });
            return {status: response.status, body: response.data};
        } catch {
            return null;
        }
    }

    private async verifyOAuth(token: string): Promise<VerifyOutcome> {
        const response = await this.get("/mcp/session", token);
        if (!response || response.status >= 500 || response.status === 429) return {ok: false, reason: "upstream_unavailable"};
        if (response.status !== 200) return {ok: false, reason: "invalid_token"};
        const body = response.body ?? {};
        const scopes = Array.isArray(body.scopes) ? body.scopes.filter((scope: unknown): scope is RemoteScope => SCOPES.includes(scope as RemoteScope)) : [];
        const expiresAt = Number(body.expires_at);
        if (typeof body.connection_id !== "string" || typeof body.resource !== "string" || !Number.isFinite(expiresAt) || expiresAt <= this.now()) {
            return {ok: false, reason: "invalid_token"};
        }
        return {ok: true, bearer: {
            auth: "oauth", connectionId: body.connection_id, resource: body.resource, scopes,
            spendingEnabled: body.spending_enabled === true && scopes.includes("spend"), expiresAt,
        }};
    }

    private async verifyApiToken(token: string, key: string): Promise<VerifyOutcome> {
        const response = await this.get("/account", token);
        if (!response || response.status >= 500 || response.status === 429) return {ok: false, reason: "upstream_unavailable"};
        if (response.status !== 200) return {ok: false, reason: "invalid_token"};
        // A raw API token has no per-connection spending switch, so it never spends here.
        return {ok: true, bearer: {
            auth: "api_token", connectionId: `api:${key.slice(0, 32)}`, resource: null,
            scopes: ["read", "manage"], spendingEnabled: false, expiresAt: this.now() + CACHE_TTL_MS,
        }};
    }
}
