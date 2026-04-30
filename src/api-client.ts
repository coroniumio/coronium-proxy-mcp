// Axios wrapper around api.coronium.io/api/v3.
//
// Two notable behaviours on top of plain axios:
//
//   1. Every authenticated request appends ?auth_token=<token>. The
//      backend accepts the token via query param OR Authorization
//      header; query param matches the prior version's pattern exactly
//      so users with cached tokens keep working.
//
//   2. On a 401 from any authenticated call, if CORONIUM_LOGIN /
//      CORONIUM_PASSWORD are present and auto-login is not disabled
//      (CORONIUM_AUTO_LOGIN=0), we transparently re-mint a token and
//      retry once. Day-to-day use feels tokenless — agents don't have
//      to handle expiry manually.
//
// Concurrency note: a single in-flight login promise is shared so a
// burst of parallel calls all wait on the same auth round-trip rather
// than each minting their own token.

import axios, {AxiosInstance, AxiosRequestConfig} from "axios";
import {config} from "./config.js";
import {logger} from "./logger.js";
import {tokenStore} from "./token-store.js";

export class CoroniumAPI {
    private client: AxiosInstance;
    private inFlightLogin: Promise<string> | null = null;

    constructor() {
        this.client = axios.create({
            baseURL: config.baseUrl,
            timeout: 30_000,
            headers: {"Content-Type": "application/json"},
        });
    }

    // ---------- Auth ----------

    /**
     * POST /get-token — exchange email+password for a JWT.
     */
    async login(login: string, password: string): Promise<string> {
        try {
            const r = await this.client.post("/get-token", {login, password});
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

    private async loginShared(): Promise<string> {
        if (this.inFlightLogin) return this.inFlightLogin;
        if (!config.login || !config.password) throw new Error("CORONIUM_LOGIN and CORONIUM_PASSWORD must be set for auto-login.");
        this.inFlightLogin = this.login(config.login, config.password)
            .finally(() => { this.inFlightLogin = null; });
        return this.inFlightLogin;
    }

    /**
     * Quick token validity probe. /account/proxies is cheap and requires
     * a valid token; 200 = good, 401 = bad.
     */
    async validateToken(token: string): Promise<boolean> {
        try {
            await this.client.get("/account/proxies", {params: {auth_token: token}});
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
        if (config.autoLoginOn401 && config.login && config.password) {
            logger.info("No cached token — auto-logging in.");
            return await this.loginShared();
        }
        throw new Error("Not authenticated. Call coronium_login first or set CORONIUM_LOGIN/CORONIUM_PASSWORD.");
    }

    private async authedRequest<T = any>(cfg: AxiosRequestConfig, explicitToken?: string): Promise<T> {
        let token = await this.tokenOrThrow(explicitToken);
        const params = {...(cfg.params || {}), auth_token: token};
        try {
            const r = await this.client.request<T>({...cfg, params});
            return r.data;
        } catch (e: any) {
            if (axios.isAxiosError(e) && e.response?.status === 401 && !explicitToken && config.autoLoginOn401 && config.login && config.password) {
                logger.warn("401 — refreshing token via auto-login and retrying once.");
                tokenStore.clear();
                token = await this.loginShared();
                const r = await this.client.request<T>({...cfg, params: {...(cfg.params || {}), auth_token: token}});
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

    public get<T = any>(url: string, params?: any, token?: string)               { return this.authedRequest<T>({method: "GET", url, params}, token); }
    public post<T = any>(url: string, data?: any, params?: any, token?: string)  { return this.authedRequest<T>({method: "POST", url, data, params}, token); }
    public put<T = any>(url: string, data?: any, params?: any, token?: string)   { return this.authedRequest<T>({method: "PUT", url, data, params}, token); }
    public del<T = any>(url: string, params?: any, token?: string)               { return this.authedRequest<T>({method: "DELETE", url, params}, token); }

    /**
     * Public routes (signup/check-token/tariffs/free-modems/countries)
     * don't require auth — call directly without injecting a token.
     */
    public async pub<T = any>(method: "GET"|"POST", url: string, data?: any, params?: any): Promise<T> {
        try {
            const r = await this.client.request<T>({method, url, data, params});
            return r.data;
        } catch (e: any) {
            throw this.translateError(e, {method, url});
        }
    }
}

export const api = new CoroniumAPI();
