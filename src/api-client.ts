// Axios wrapper around api.coronium.io.
//
// Two notable behaviours on top of plain axios:
//
//   1. Every request appends ?auth_token=<token> from the token store. The
//      backend accepts the token via query param OR Authorization header;
//      query param matches the prior version's pattern exactly so users
//      with cached tokens keep working.
//
//   2. On a 401 from any authenticated call, if CORONIUM_LOGIN /
//      CORONIUM_PASSWORD are present in the environment and auto-login is
//      not disabled (CORONIUM_AUTO_LOGIN=0), we transparently re-mint a
//      token and retry the request once. This makes day-to-day use feel
//      tokenless — agents don't need to handle expiry manually.

import axios, {AxiosInstance, AxiosRequestConfig, AxiosError} from "axios";
import {config} from "./config.js";
import {logger} from "./logger.js";
import {tokenStore} from "./token-store.js";

export class CoroniumAPI {
    private v1: AxiosInstance;
    private v3: AxiosInstance;

    constructor() {
        this.v1 = axios.create({baseURL: config.baseUrl, timeout: 30000, headers: {"Content-Type": "application/json"}});
        this.v3 = axios.create({baseURL: config.baseUrlV3, timeout: 30000, headers: {"Content-Type": "application/json"}});
    }

    // ---------- Auth ----------

    /**
     * POST /v1/get-token — exchange email+password for a JWT.
     * Surfaces friendly messages for 401/429; everything else falls through.
     */
    async login(login: string, password: string): Promise<string> {
        try {
            const r = await this.v1.post("/get-token", {login, password});
            const token = r.data?.token;
            if (!token) throw new Error("Login succeeded but server did not return a token.");
            tokenStore.set(token);
            return token;
        } catch (e: any) {
            if (axios.isAxiosError(e)) {
                const s = e.response?.status;
                const m = e.response?.data?.error || e.response?.data?.message || e.message;
                if (s === 401) throw new Error("Invalid credentials. Check CORONIUM_LOGIN and CORONIUM_PASSWORD.");
                if (s === 429) throw new Error("Rate limited by login endpoint. Wait a minute and retry.");
                if (s) throw new Error(`Login failed (${s}): ${m}`);
            }
            throw e;
        }
    }

    /**
     * Quick token validity probe. We hit /v1/account/proxies because that
     * route is cheap and requires a valid token; 200 = good, 401 = bad.
     */
    async validateToken(token: string): Promise<boolean> {
        try {
            await this.v1.get("/account/proxies", {params: {auth_token: token}});
            return true;
        } catch (e: any) {
            if (axios.isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) return false;
            throw e;
        }
    }

    // ---------- Authenticated request helpers ----------

    private async tokenOrThrow(explicit?: string): Promise<string> {
        const t = explicit || tokenStore.get();
        if (t) return t;
        // Try auto-login if creds are in env.
        if (config.autoLoginOn401 && config.login && config.password) {
            logger.info("No cached token — auto-logging in.");
            return await this.login(config.login, config.password);
        }
        throw new Error("Not authenticated. Call coronium_login first or set CORONIUM_LOGIN/CORONIUM_PASSWORD.");
    }

    /**
     * Authenticated request wrapper. Adds auth_token, retries once on 401
     * via auto-login, surfaces clean errors.
     *
     * @param api which axios instance — "v1" for /v1/* or "v3" for /v3/*
     */
    private async authedRequest<T = any>(api: "v1" | "v3", cfg: AxiosRequestConfig, explicitToken?: string): Promise<T> {
        const inst = api === "v3" ? this.v3 : this.v1;
        let token = await this.tokenOrThrow(explicitToken);
        const params = {...(cfg.params || {}), auth_token: token};
        try {
            const r = await inst.request<T>({...cfg, params});
            return r.data;
        } catch (e: any) {
            if (axios.isAxiosError(e) && e.response?.status === 401 && !explicitToken && config.autoLoginOn401 && config.login && config.password) {
                logger.warn("401 — refreshing token via auto-login and retrying once.");
                tokenStore.clear();
                token = await this.login(config.login, config.password);
                const r = await inst.request<T>({...cfg, params: {...(cfg.params || {}), auth_token: token}});
                return r.data;
            }
            throw this.translateError(e, cfg);
        }
    }

    private translateError(e: any, cfg: AxiosRequestConfig): Error {
        if (!axios.isAxiosError(e)) return e;
        const status = e.response?.status;
        const data = e.response?.data || {};
        const msg = data.error || data.message || e.message;
        const where = `${(cfg.method || "GET").toUpperCase()} ${cfg.url}`;
        if (status === 401) return new Error(`Unauthorized (${where}). Token expired or invalid.`);
        if (status === 402) return new Error(`Payment required (${where}): ${msg}`);
        if (status === 403) return new Error(`Forbidden (${where}): ${msg}`);
        if (status === 404) return new Error(`Not found (${where}): ${msg}`);
        if (status === 422) return new Error(`Validation failed (${where}): ${msg}`);
        if (status === 429) return new Error(`Rate limited (${where}): ${msg}`);
        if (status && status >= 500) return new Error(`Server error ${status} (${where}): ${msg}`);
        return new Error(`${where} failed: ${msg}`);
    }

    // ---------- Public route methods ----------

    // v1
    public v1Get<T = any>(url: string, params?: any, token?: string)            { return this.authedRequest<T>("v1", {method: "GET", url, params}, token); }
    public v1Post<T = any>(url: string, data?: any, params?: any, token?: string)  { return this.authedRequest<T>("v1", {method: "POST", url, data, params}, token); }
    public v1Put<T = any>(url: string, data?: any, params?: any, token?: string)   { return this.authedRequest<T>("v1", {method: "PUT", url, data, params}, token); }
    public v1Delete<T = any>(url: string, params?: any, token?: string)         { return this.authedRequest<T>("v1", {method: "DELETE", url, params}, token); }

    // v3
    public v3Get<T = any>(url: string, params?: any, token?: string)            { return this.authedRequest<T>("v3", {method: "GET", url, params}, token); }
    public v3Post<T = any>(url: string, data?: any, params?: any, token?: string)  { return this.authedRequest<T>("v3", {method: "POST", url, data, params}, token); }
    public v3Put<T = any>(url: string, data?: any, params?: any, token?: string)   { return this.authedRequest<T>("v3", {method: "PUT", url, data, params}, token); }
    public v3Delete<T = any>(url: string, params?: any, token?: string)         { return this.authedRequest<T>("v3", {method: "DELETE", url, params}, token); }

    /**
     * Public v3 routes (signup/tariffs/free-modems) don't need auth — call
     * directly without injecting a token.
     */
    public async v3Public<T = any>(method: "GET"|"POST", url: string, data?: any, params?: any): Promise<T> {
        try {
            const r = await this.v3.request<T>({method, url, data, params});
            return r.data;
        } catch (e: any) {
            throw this.translateError(e, {method, url});
        }
    }
}

export const api = new CoroniumAPI();
