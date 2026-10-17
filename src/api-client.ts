import axios, {type AxiosResponse} from "axios";
import {createHash} from "node:crypto";
import {config} from "./config.js";
import {classifyError, CoroniumError, type ErrorDetails, invalidResponse, normalizeErrorCode, redact, retryAfterSeconds} from "./errors.js";
import {spendingAllowed} from "./profiles.js";
import {tokenStore} from "./token-store.js";

export type ApiObject = Record<string, any>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions {
    method?: Method;
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
    // Restart and rotate-by-token: a 429 is a rotation cooldown.
    rotation?: boolean;
    // Diagnostic routes answer HTTP 200 with an error string for a failed test.
    // That is a normal result for them, not an ambiguous mutation.
    diagnostic?: boolean;
}

interface PaymentIntent {
    fingerprint: string;
    result: Promise<ApiObject>;
}

const HTML_PATTERN = /^\s*(?:<!doctype\s+html|<html|<head|<body)\b/i;
const AUTH_FAILURE_PATTERN = /no auth token|unauthori[sz]ed|jwt expired|invalid (?:auth )?token|not authenticated/i;

function isAuthFailure(status: number | undefined, body: ApiObject): boolean {
    if (status !== 401) return false;
    // A 401 that reports required/available amounts is an insufficient-balance refusal.
    if ("required" in body || "available" in body) return false;
    return AUTH_FAILURE_PATTERN.test(body.error || body.message || "");
}

function isSuccess(status: number): boolean {
    return status >= 200 && status < 300;
}

function parseBody(response: AxiosResponse<string>, options: RequestOptions): unknown {
    try {
        return response.data ? JSON.parse(response.data) : null;
    } catch {
        const plainText = options.text && isSuccess(response.status) && !HTML_PATTERN.test(response.data);
        if (plainText) return response.data;
        return null;
    }
}

function buildHeaders(options: RequestOptions, token: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {Accept: options.text ? "text/plain, application/octet-stream" : "application/json"};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    return headers;
}

function requestId(body: ApiObject, response: AxiosResponse): string | undefined {
    return body.request_id || body.requestId || response.headers["x-request-id"];
}

function unknownOutcome(mutates: boolean): Partial<ErrorDetails> {
    if (!mutates) return {suggested_action: "contact_support"};
    return {outcome: "unknown", suggested_action: "check_state_before_retrying"};
}

function intentKey(options: RequestOptions): Partial<ErrorDetails> {
    return options.idempotencyKey ? {idempotency_key: options.idempotencyKey} : {};
}

function successWithErrorBody(response: AxiosResponse, body: ApiObject, mutates: boolean, options: RequestOptions): CoroniumError {
    return new CoroniumError({
        status: response.status,
        code: normalizeErrorCode(body.code) ?? "upstream_rejected",
        ...(body.code && normalizeErrorCode(body.code) !== body.code ? {backend_code: body.code} : {}),
        message: body.error,
        details: redact(body),
        request_id: requestId(body, response),
        ...(mutates ? {outcome: "unknown" as const, suggested_action: "check_state_before_retrying"} : {}),
        ...intentKey(options),
    });
}

function httpError(response: AxiosResponse, body: ApiObject, mutates: boolean, options: RequestOptions): CoroniumError {
    const classification = classifyError({status: response.status, body, rotation: options.rotation === true, mutates});
    const retryAfter = retryAfterSeconds(response.headers["retry-after"], body);
    const backendCode = typeof body.code === "string" && body.code !== classification.code ? body.code : undefined;
    return new CoroniumError({
        status: response.status,
        code: classification.code,
        ...(backendCode ? {backend_code: backendCode} : {}),
        message: String(body.error || body.message || `Coronium returned HTTP ${response.status}.`),
        request_id: requestId(body, response),
        ...(classification.suggested_action ? {suggested_action: classification.suggested_action} : {}),
        ...(retryAfter !== undefined ? {retry_after_seconds: retryAfter} : {}),
        ...intentKey(options),
        ...(classification.outcome ? {outcome: classification.outcome} : {}),
        details: redact(body),
    });
}

export function assertSpendingAllowed(): void {
    if (spendingAllowed(config.profile, config.spendingEnabled)) return;
    throw new CoroniumError({
        code: "spending_disabled",
        message: "Spending and refund actions are turned off. They need CORONIUM_TOOL_PROFILE=full and CORONIUM_ENABLE_SPENDING=1. Use https://dashboard.coronium.io to pay.",
        suggested_action: "use_dashboard",
    });
}

export class CoroniumAPI {
    private inFlightLogin: Promise<string> | null = null;
    private autoLoginDisabled = false;
    private paymentIntents = new Map<string, PaymentIntent>();

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
        const current = tokenStore.get();
        if (current) return current;
        if (!config.autoLoginOn401 || this.autoLoginDisabled || !config.login || !config.password) {
            throw new CoroniumError({code: "not_authenticated", message: "Set CORONIUM_API_TOKEN (or CORONIUM_API_KEY), or log in with CORONIUM_LOGIN/CORONIUM_PASSWORD.", suggested_action: "authenticate"});
        }
        if (!this.inFlightLogin) {
            this.inFlightLogin = this.login(config.login, config.password)
                .then(() => tokenStore.get()!)
                .finally(() => { this.inFlightLogin = null; });
        }
        return this.inFlightLogin;
    }

    private canRefreshLogin(attempt: number, method: Method, mutates: boolean, token: string | undefined, options: RequestOptions): boolean {
        if (attempt > 0 || mutates || method !== "GET" || options.token || options.public) return false;
        // An explicitly configured API token is never swapped for a login token.
        if (token === config.apiToken) return false;
        return config.autoLoginOn401 && !this.autoLoginDisabled && Boolean(config.login && config.password);
    }

    async request(path: string, options: RequestOptions = {}): Promise<any> {
        const method: Method = options.method || "GET";
        const mutates: boolean = options.mutates ?? (method !== "GET" && !options.readOnly);
        if (config.readOnly && mutates) throw new CoroniumError({code: "read_only", message: "This MCP is configured for read-only access."});
        // Paths are code-owned; dynamic segments must be URL-encoded by callers.
        if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) throw new Error("Invalid API path.");
        const url = options.catalog ? config.catalogUrl : config.baseUrl + path;
        let token = options.public ? undefined : (options.token || await this.authenticate());
        for (let attempt = 0; attempt < 2; attempt++) {
            let response: AxiosResponse<string>;
            try {
                response = await axios.request({
                    method, url, params: options.query, data: options.body,
                    headers: buildHeaders(options, token),
                    timeout: options.timeoutMs ?? config.timeoutMs,
                    maxRedirects: 0,
                    responseType: "text",
                    validateStatus: () => true,
                });
            } catch (error) {
                throw new CoroniumError({
                    code: axios.isAxiosError(error) ? (error.code || "network_error") : "request_failed",
                    message: "Coronium request did not complete. No automatic retry was made.",
                    ...(mutates ? {outcome: "unknown" as const, suggested_action: "check_state_before_retrying"} : {}),
                    ...intentKey(options),
                });
            }
            const body = parseBody(response, options);
            if (isSuccess(response.status)) return this.success(response, body, mutates, options);
            const errorBody: ApiObject = body && typeof body === "object" ? body as ApiObject : {};
            // Never replay a mutation, including a money request that returns 401 for insufficient BTC.
            if (this.canRefreshLogin(attempt, method, mutates, token, options) && isAuthFailure(response.status, errorBody)) {
                tokenStore.clear();
                token = await this.authenticate();
                continue;
            }
            throw httpError(response, errorBody, mutates, options);
        }
        throw new Error("Authentication refresh failed.");
    }

    private success(response: AxiosResponse, body: unknown, mutates: boolean, options: RequestOptions): unknown {
        if (body === null && response.status !== 204) {
            throw new CoroniumError({code: "invalid_response",
                message: "API returned an empty or non-JSON response instead of the expected contract.",
                ...unknownOutcome(mutates), ...intentKey(options)});
        }
        const object = body as ApiObject;
        // Some legacy handlers report refusal as HTTP 200 with an error string
        // (for example, an existing pending BTC payment).
        const hasErrorString = object && typeof object.error === "string" && object.error;
        if (hasErrorString && !options.diagnostic) throw successWithErrorBody(response, object, mutates, options);
        if (!options.receipt) return body;
        return {response: body, request: {idempotency_key: options.idempotencyKey,
            request_id: response.headers["x-request-id"] ?? null, replayed: response.headers["x-idempotency-replay"] === "true"}};
    }

    get(path: string, query?: Record<string, unknown>, options: RequestOptions = {}): Promise<any> { return this.request(path, {...options, query}); }
    post(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<any> { return this.request(path, {...options, method: "POST", body}); }
    put(path: string, body: unknown = {}): Promise<any> { return this.request(path, {method: "PUT", body}); }
    del(path: string, options: RequestOptions = {}): Promise<any> { return this.request(path, {...options, method: "DELETE"}); }
    publicGet(path: string, query?: Record<string, unknown>): Promise<any> { return this.request(path, {query, public: true}); }
    catalog(): Promise<any> { return this.request("/tariffs", {public: true, catalog: true}); }

    async payment(path: string, body: unknown, idempotencyKey: string): Promise<ApiObject> {
        // Defence in depth: spending tools are not registered unless allowed,
        // and the transport refuses money calls on its own as well.
        assertSpendingAllowed();
        const token = await this.authenticate();
        const accountScope = createHash("sha256").update(token).digest("hex");
        const key = `${accountScope}:${idempotencyKey}`;
        const fingerprint = createHash("sha256").update(JSON.stringify({path, body})).digest("hex");
        const previous = this.paymentIntents.get(key);
        if (previous) {
            if (previous.fingerprint !== fingerprint) throw new CoroniumError({code: "idempotency_conflict",
                message: "This key already identifies a different payment request in this session. Do not change a payment's payload or route while reconciling it.", idempotency_key: idempotencyKey});
            return previous.result;
        }
        if (this.paymentIntents.size >= 10_000) throw new CoroniumError({code: "session_intent_limit", message: "Restart the MCP after reconciling outstanding payments; the session intent limit was reached."});
        // Coalesce concurrent identical calls. Keep both successes and failures:
        // an ambiguous payment must be reconciled, never automatically resubmitted.
        const result = this.post(path, body, {token, idempotencyKey, receipt: true, timeoutMs: config.actionTimeoutMs});
        this.paymentIntents.set(key, {fingerprint, result});
        return result;
    }
}

export const api = new CoroniumAPI();
