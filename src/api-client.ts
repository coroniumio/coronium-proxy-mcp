import axios from "axios";
import {createHash} from "node:crypto";
import {config} from "./config.js";
import {CoroniumError, invalidResponse, redact} from "./errors.js";
import {tokenStore} from "./token-store.js";

export type ApiObject = Record<string, any>;
interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    query?: Record<string, unknown>;
    public?: boolean;
    token?: string;
    readOnly?: boolean;
    mutates?: boolean;
    text?: boolean;
    timeoutMs?: number;
    idempotencyKey?: string;
    receipt?: boolean;
    catalog?: boolean;
}

function isAuthFailure(status: number | undefined, body: ApiObject): boolean {
    return status === 401 && !('required' in body || 'available' in body)
        && /no auth token|unauthori[sz]ed|jwt expired|invalid (?:auth )?token|not authenticated/i.test(body.error || body.message || "");
}

export class CoroniumAPI {
    private inFlightLogin: Promise<string> | null = null;
    private autoLoginDisabled = false;
    private paymentIntents = new Map<string, {fingerprint: string; result: Promise<ApiObject>}>();

    async login(login: string, password: string): Promise<void> {
        const body = await this.request("/get-token", {method: "POST", body: {login, password}, public: true, readOnly: true});
        if (typeof body?.token !== "string" || !body.token) invalidResponse("Login returned no token.");
        tokenStore.set(body.token);
        this.autoLoginDisabled = false;
    }

    logout(): void {
        tokenStore.clear();
        this.autoLoginDisabled = true;
    }

    async validateToken(token?: string): Promise<boolean> {
        const value = token || tokenStore.get();
        if (!value) return false;
        try {
            await this.request("/account", {token: value});
            return true;
        } catch (error) {
            if (error instanceof CoroniumError && [401, 403].includes(error.details.status || 0)) return false;
            throw error;
        }
    }

    private async authenticate(): Promise<string> {
        if (tokenStore.get()) return tokenStore.get()!;
        if (!config.autoLoginOn401 || this.autoLoginDisabled || !config.login || !config.password) {
            throw new CoroniumError({code: "not_authenticated", message: "Set CORONIUM_API_TOKEN (or CORONIUM_API_KEY), or log in with CORONIUM_LOGIN/CORONIUM_PASSWORD.", suggested_action: "authenticate"});
        }
        if (!this.inFlightLogin) {
            this.inFlightLogin = this.login(config.login, config.password).then(() => tokenStore.get()!).finally(() => { this.inFlightLogin = null; });
        }
        return this.inFlightLogin;
    }

    async request(path: string, options: RequestOptions = {}): Promise<any> {
        const method = options.method || "GET";
        const mutates = options.mutates ?? (method !== "GET" && !options.readOnly);
        if (config.readOnly && mutates) throw new CoroniumError({code: "read_only", message: "This MCP is configured for read-only access."});
        // Paths are code-owned; dynamic segments must be URL-encoded by callers.
        if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) throw new Error("Invalid API path.");
        const url = options.catalog ? config.catalogUrl : config.baseUrl + path;
        let token = options.public ? undefined : (options.token || await this.authenticate());
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await axios.request({
                    method, url, params: options.query, data: options.body,
                    headers: {Accept: options.text ? "text/plain, application/octet-stream" : "application/json",
                        ...(token ? {Authorization: `Bearer ${token}`} : {}),
                        ...(options.body !== undefined ? {"Content-Type": "application/json"} : {}),
                        ...(options.idempotencyKey ? {"Idempotency-Key": options.idempotencyKey} : {})},
                    timeout: options.timeoutMs ?? config.timeoutMs,
                    maxRedirects: 0,
                    responseType: "text",
                    validateStatus: () => true,
                });
                let body: any;
                try { body = response.data ? JSON.parse(response.data) : null; }
                catch {
                    if (options.text && response.status >= 200 && response.status < 300 && !/^\s*(?:<!doctype\s+html|<html|<head|<body)\b/i.test(response.data)) body = response.data;
                    else body = null;
                }
                if (response.status >= 200 && response.status < 300) {
                    if (body === null && response.status !== 204) throw new CoroniumError({code: "invalid_response",
                        message: "API returned an empty or non-JSON response instead of the expected contract.",
                        ...(mutates ? {outcome: "unknown" as const, suggested_action: "check_state_before_retrying"} : {suggested_action: "contact_support"}),
                        ...(options.idempotencyKey ? {idempotency_key: options.idempotencyKey} : {})});
                    // Some legacy handlers report refusal as HTTP 200 with an
                    // error string (for example, an existing pending BTC payment).
                    if (body && typeof body.error === "string" && body.error) throw new CoroniumError({status: response.status,
                        code: body.code || "upstream_rejected", message: body.error, details: redact(body),
                        request_id: body.request_id || response.headers['x-request-id'],
                        ...(mutates ? {outcome: "unknown" as const, suggested_action: "check_state_before_retrying"} : {}),
                        ...(options.idempotencyKey ? {idempotency_key: options.idempotencyKey} : {})});
                    if (options.receipt) return {response: body, request: {idempotency_key: options.idempotencyKey,
                        request_id: response.headers['x-request-id'] ?? null, replayed: response.headers['x-idempotency-replay'] === 'true'}};
                    return body;
                }
                const errorBody: ApiObject = body && typeof body === "object" ? body : {};
                // Never replay a mutation, including a money request that returns 401 for insufficient BTC.
                if (attempt === 0 && !mutates && method === "GET" && !options.token && !options.public
                    && token !== config.apiToken && config.autoLoginOn401 && !this.autoLoginDisabled
                    && config.login && config.password && isAuthFailure(response.status, errorBody)) {
                    tokenStore.clear();
                    token = await this.authenticate();
                    continue;
                }
                const retryValue = response.headers['retry-after'] ?? errorBody.retryAfter;
                const retryAfter = retryValue === undefined ? NaN : /^\d+(\.\d+)?$/.test(String(retryValue))
                    ? Number(retryValue) : Math.max(0, Math.ceil((Date.parse(String(retryValue)) - Date.now()) / 1000));
                throw new CoroniumError({status: response.status, code: errorBody.code || `http_${response.status}`,
                    message: String(errorBody.error || errorBody.message || `Coronium returned HTTP ${response.status}.`),
                    request_id: errorBody.request_id || errorBody.requestId || response.headers['x-request-id'],
                    suggested_action: mutates && response.status >= 500 ? "check_state_before_retrying" : errorBody.suggested_action,
                    ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? {retry_after_seconds: retryAfter} : {}),
                    ...(options.idempotencyKey ? {idempotency_key: options.idempotencyKey} : {}),
                    ...(mutates && response.status >= 500 ? {outcome: "unknown" as const} : {}), details: redact(errorBody)});
            } catch (error) {
                if (error instanceof CoroniumError) throw error;
                throw new CoroniumError({code: axios.isAxiosError(error) ? (error.code || "network_error") : "request_failed",
                    message: "Coronium request did not complete. No automatic retry was made.",
                    ...(mutates ? {outcome: "unknown" as const, suggested_action: "check_state_before_retrying"} : {}),
                    ...(options.idempotencyKey ? {idempotency_key: options.idempotencyKey} : {})});
            }
        }
        throw new Error("Authentication refresh failed.");
    }

    get(path: string, query?: Record<string, unknown>, options: RequestOptions = {}): Promise<any> { return this.request(path, {...options, query}); }
    post(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<any> { return this.request(path, {...options, method: "POST", body}); }
    put(path: string, body: unknown = {}): Promise<any> { return this.request(path, {method: "PUT", body}); }
    del(path: string, options: RequestOptions = {}): Promise<any> { return this.request(path, {...options, method: "DELETE"}); }
    publicGet(path: string, query?: Record<string, unknown>): Promise<any> { return this.request(path, {query, public: true}); }
    catalog(): Promise<any> { return this.request("/tariffs", {public: true, catalog: true}); }
    async payment(path: string, body: unknown, idempotencyKey: string): Promise<ApiObject> {
        const token = await this.authenticate();
        const accountScope = createHash("sha256").update(token).digest("hex");
        const intentKey = `${accountScope}:${idempotencyKey}`;
        const fingerprint = createHash("sha256").update(JSON.stringify({path, body})).digest("hex");
        const previous = this.paymentIntents.get(intentKey);
        if (previous) {
            if (previous.fingerprint !== fingerprint) throw new CoroniumError({code: "idempotency_conflict",
                message: "This key already identifies a different payment request in this session. Do not change a payment's payload or route while reconciling it.", idempotency_key: idempotencyKey});
            return previous.result;
        }
        if (this.paymentIntents.size >= 10_000) throw new CoroniumError({code: "session_intent_limit", message: "Restart the MCP after reconciling outstanding payments; the session intent limit was reached."});
        // Coalesce concurrent identical calls. Keep both successes and failures:
        // an ambiguous payment must be reconciled, never automatically resubmitted.
        const result = this.post(path, body, {token, idempotencyKey, receipt: true, timeoutMs: config.actionTimeoutMs});
        this.paymentIntents.set(intentKey, {fingerprint, result});
        return result;
    }
}

export const api = new CoroniumAPI();
