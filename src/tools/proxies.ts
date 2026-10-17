import {randomBytes} from "node:crypto";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api, type ApiObject, assertSpendingAllowed} from "../api-client.js";
import {config} from "../config.js";
import {CoroniumError, invalidResponse} from "../errors.js";
import {unwrap} from "../formatters.js";
import {findProxy, normalizedProxies, proxyField, resolveProxyId} from "../proxies.js";
import {type RotationResult, toRotationResult} from "../rotation.js";
import {confirmation, countrySchema, registerTool, usdAmount} from "../tool.js";

// One cancel or replace per modem at a time within this process. The backend
// does not serialize these, so a duplicate concurrent call is refused here.
const modemActions = new Map<string, Promise<unknown>>();

async function withModemLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (modemActions.has(id)) {
        throw new CoroniumError({code: "modem_action_in_progress",
            message: "Another cancel or replace for this proxy is still running in this session. Wait for its result before acting again.",
            suggested_action: "wait_for_previous_result"});
    }
    const running = action();
    modemActions.set(id, running);
    try {
        return await running;
    } finally {
        modemActions.delete(id);
    }
}

async function restart(identifier: string): Promise<RotationResult> {
    const id = await resolveProxyId(identifier);
    const response = await api.post(`/modems/${id}/restart`, {}, {timeoutMs: config.actionTimeoutMs, rotation: true});
    return toRotationResult(response);
}

async function rotateByToken(token: string): Promise<RotationResult> {
    const response = await api.get(`/modems/rotate-modem-by-token/${encodeURIComponent(token)}`, undefined,
        {public: true, mutates: true, timeoutMs: config.actionTimeoutMs, rotation: true});
    return toRotationResult(response);
}

function isRotationToken(value: string): boolean {
    return z.string().uuid().safeParse(value).success;
}

// /modems/:id/test reports a failed check as HTTP 200 or 201 with an error string.
function diagnosticPassed(response: ApiObject): boolean {
    if (typeof response?.error === "string" && response.error) return false;
    const inner = response?.data?.error;
    if (typeof inner === "string" && inner) return false;
    return Boolean(response?.data);
}

function filterProxies(proxies: ApiObject[], countryCode?: string, onlineOnly?: boolean, expiringWithinDays?: number): ApiObject[] {
    let rows = proxies;
    if (countryCode) rows = rows.filter(proxy => proxy.country_code === countryCode);
    if (onlineOnly) rows = rows.filter(proxy => proxy.isOnline === true);
    if (expiringWithinDays !== undefined) {
        const cutoff = Date.now() + expiringWithinDays * 86_400_000;
        rows = rows.filter(proxy => proxy.tariff_expired_at && Number(proxy.tariff_expired_at) <= cutoff);
    }
    return rows;
}

function refundOf(preview: ApiObject): number {
    const amount = Number(preview?.refundAmount);
    if (preview?.refundAmount === undefined || preview?.refundAmount === null || !Number.isFinite(amount)) {
        invalidResponse("The cancellation preview returned no refund amount. Nothing was cancelled.");
    }
    return amount;
}

async function cancelModem(identifier: string, minimumRefundUsd: number, reason?: string): Promise<Record<string, unknown>> {
    assertSpendingAllowed();
    const id = await resolveProxyId(identifier);
    return withModemLock(id, async () => {
        // Re-run the preview right before the real call. The refund shrinks with
        // time, so the check is one-sided: refuse only below the approved floor.
        const preview = await api.post(`/modems/${id}/cancel`, {dryRun: true}, {readOnly: true});
        const refund = refundOf(preview);
        if (refund + 0.005 < minimumRefundUsd) {
            throw new CoroniumError({code: "refund_changed",
                message: `The refund is now $${refund.toFixed(2)}, below the $${minimumRefundUsd.toFixed(2)} the user approved. Nothing was cancelled. Show the new preview and ask again.`,
                details: preview, suggested_action: "preview_and_confirm_again"});
        }
        const response = await api.post(`/modems/${id}/cancel`, {reason}, {timeoutMs: config.actionTimeoutMs});
        return {preview_before_submission: preview, response};
    });
}

function registerRotationTools(server: McpServer): void {
    registerTool(server, "coronium_restart_modem", {
        description: "Rotate an owned proxy's IP and wait for the backend result. Existing connections drop for a short time. Returns state done (new IP), rotating (in progress: poll get_rotation_status, never resubmit) or unchanged (the carrier kept the same IP; wait about 60 seconds before trying again). A rotation_cooldown error carries retry_after_seconds.",
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "POST /modems/:modem_id/restart"],
        run: async ({proxy}) => restart(proxy),
    });
    registerTool(server, "coronium_rotate_modem", {
        description: "Get a fresh IP from the carrier for an owned proxy, by modem ID or name, or by its rotation token (UUID). Existing connections drop for a short time. Returns state done (new IP), rotating (in progress: poll get_rotation_status, never resubmit or replace) or unchanged (same IP; wait about 60 seconds before trying again). A rotation_cooldown error carries retry_after_seconds: wait that long. Keep rotation tokens private: anyone who opens the token link rotates the IP.",
        input: {proxy_identifier: proxyField, confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "POST /modems/:modem_id/restart", "GET /modems/rotate-modem-by-token/:token"],
        run: async ({proxy_identifier}) => {
            if (isRotationToken(proxy_identifier)) return rotateByToken(proxy_identifier);
            return restart(proxy_identifier);
        },
    });
    registerTool(server, "coronium_get_rotation_status", {
        description: "Read rotation state: idle, rotating, done or failed, plus IP, timing and failure details. A pending or idle state does not prove a completed rotation.",
        input: {proxy: proxyField}, routes: ["GET /account/proxies", "GET /modems/:modem_id/rotation-status"],
        run: async ({proxy}) => ({response: await api.get(`/modems/${await resolveProxyId(proxy)}/rotation-status`)}),
    });
    registerTool(server, "coronium_set_rotation_interval", {
        description: "Set auto-rotation cadence: 0 disables it, otherwise 60-86400 seconds. Rotation interrupts connections, so changing this requires authorization.",
        input: {proxy: proxyField, interval_seconds: z.number().int().min(0).max(86_400).refine(value => value === 0 || value >= 60, "Use 0 or at least 60 seconds."), confirm: confirmation},
        access: "write", destructive: true, idempotent: true,
        routes: ["GET /account/proxies", "PUT /modems/:modem_id/set-rotation-interval"],
        run: async ({proxy, interval_seconds}) => ({response: await api.put(`/modems/${await resolveProxyId(proxy)}/set-rotation-interval`, {rotation_interval: interval_seconds})}),
    });
}

function registerCancellationTools(server: McpServer): void {
    registerTool(server, "coronium_preview_modem_cancellation", {
        description: "Preview the refund for cancelling an owned proxy (dryRun). Does not cancel, release or change the proxy. Auto-renew is not managed here; it is managed in the dashboard.",
        input: {proxy: proxyField}, routes: ["GET /account/proxies", "POST /modems/:modem_id/cancel"],
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/cancel`, {dryRun: true}, {readOnly: true})}),
    });
    registerTool(server, "coronium_cancel_modem", {
        description: "IMMEDIATELY cancel and release an owned proxy and credit any pro-rata refund to account credit. The proxy stops working now and cannot be restored. This is NOT a way to stop auto-renew; never use it for that (auto-renew is managed in the dashboard). Preview first, then pass the approved minimum refund: the tool re-runs the preview and refuses if the refund is now lower. Some rental types cannot be cancelled here (CANCEL_UNSUPPORTED).",
        input: {proxy: proxyField, min_refund_usd: usdAmount.describe("Cancel only if the fresh refund is at least this many USD (the amount the user approved from the preview)."),
            reason: z.string().max(2000).optional(), confirm: confirmation},
        access: "write", money: "refunds", destructive: true,
        routes: ["GET /account/proxies", "POST /modems/:modem_id/cancel"],
        run: async ({proxy, min_refund_usd, reason}) => cancelModem(proxy, min_refund_usd, reason),
    });
}

function registerSettingsTools(server: McpServer): void {
    registerTool(server, "coronium_change_proxy_password", {
        description: "Change an owned proxy's password; the previous password stops working immediately. Supply 8-128 printable characters without spaces, or omit to generate a random password in this MCP process. The password is sent to the backend and returned to you.",
        input: {proxy: proxyField, proxy_password: z.string().min(6).max(128).optional(), confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "PUT /modems/:modem_id/change-password"],
        run: async ({proxy, proxy_password}) => {
            const password = proxy_password || randomBytes(24).toString("base64url");
            const response = await api.put(`/modems/${await resolveProxyId(proxy)}/change-password`, {proxy_password: password});
            return {response, proxy_password: password};
        },
    });
    registerTool(server, "coronium_set_modem_metadata", {
        description: "Set a private owner note. Objects are JSON-serialized to the backend's metadata string; this does not rename hardware or change ports.",
        input: {proxy: proxyField, metadata: z.union([z.string().max(8000), z.record(z.unknown())])}, access: "write", idempotent: true,
        routes: ["GET /account/proxies", "PUT /modems/:modem_id/set-metadata"],
        run: async ({proxy, metadata}) => {
            const text = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
            return {response: await api.put(`/modems/${await resolveProxyId(proxy)}/set-metadata`, {metadata: text})};
        },
    });
    registerTool(server, "coronium_get_p0f_options", {
        description: "Read which OS (TCP fingerprint) presets this modem supports, the current preset and the change cooldown. Support differs by server.",
        input: {proxy: proxyField}, routes: ["GET /account/proxies", "GET /modems/:modem_id/p0f-options"],
        run: async ({proxy}) => ({response: await api.get(`/modems/${await resolveProxyId(proxy)}/p0f-options`)}),
    });
    registerTool(server, "coronium_set_modem_os", {
        description: "Set the TCP fingerprint OS preset to a value from this modem's p0f-options, or an empty string to turn it off when supported. Checks support first. May reapply settings and interrupt connections.",
        input: {proxy: proxyField, os: z.string().max(128), confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "GET /modems/:modem_id/p0f-options", "PUT /modems/:modem_id/set-os"],
        run: async ({proxy, os}) => {
            const id = await resolveProxyId(proxy);
            const options = unwrap(await api.get(`/modems/${id}/p0f-options`));
            const supported = options?.supported && Array.isArray(options.options) && (os === "" || options.options.includes(os));
            if (!supported) {
                throw new CoroniumError({code: "unsupported_os", message: "This modem does not advertise support for that OS preset.", details: options, suggested_action: "get_p0f_options"});
            }
            return {response: await api.put(`/modems/${id}/set-os`, {os})};
        },
    });
    registerTool(server, "coronium_apply_modem_settings", {
        description: "Ask the backend to reapply an owned proxy's current settings. May interrupt connections. Requires explicit authorization.",
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "POST /modems/:modem_id/apply-settings"],
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/apply-settings`, {}, {timeoutMs: config.actionTimeoutMs})}),
    });
}

export function registerProxyTools(server: McpServer): void {
    registerTool(server, "coronium_get_proxies", {
        description: "List owned proxies with credentials, ready-to-use http_url and socks5_url, country, expiry and per-proxy capabilities. When a proxy has separate HTTP and SOCKS5 logins, each URL uses its own login. Connection details are secrets. Listing does not test connectivity.",
        input: {country_code: countrySchema.optional(), online_only: z.boolean().optional(), expiring_within_days: z.number().int().positive().optional()},
        routes: ["GET /account/proxies", "GET /countries"],
        run: async ({country_code, online_only, expiring_within_days}) => {
            const proxies = filterProxies(await normalizedProxies(), country_code, online_only, expiring_within_days);
            return {proxies, count: proxies.length};
        },
    });
    registerTool(server, "coronium_get_proxy", {
        description: "Read one owned proxy: credentials, http_url and socks5_url, expiry, rotation token and capability flags. Treat the result as secret. No connection is tested.",
        input: {proxy: proxyField}, routes: ["GET /account/proxies", "GET /countries"],
        run: async ({proxy}) => ({proxy: findProxy(await normalizedProxies(), proxy)}),
    });
    registerTool(server, "coronium_get_proxy_health", {
        description: "Read the backend health snapshot for owned proxies. It is evidence for diagnosis, not a reason to replace or reconfigure a proxy on its own, and does not prove every protocol works.",
        input: {}, routes: ["GET /account/proxies/health"],
        run: async () => ({response: await api.get("/account/proxies/health")}),
    });
    registerTool(server, "coronium_test_modem", {
        description: "Ask the backend to run its connectivity check on an owned proxy. Returns ok:true or ok:false with the backend's reason. Makes real network traffic. It does not verify HTTP and SOCKS5 separately.",
        input: {proxy: proxyField}, access: "write",
        routes: ["GET /account/proxies", "POST /modems/:modem_id/test"],
        run: async ({proxy}) => {
            const response = await api.post(`/modems/${await resolveProxyId(proxy)}/test`, {}, {timeoutMs: config.actionTimeoutMs, diagnostic: true});
            return {ok: diagnosticPassed(response), response, independently_verified_protocols: []};
        },
    });
    registerTool(server, "coronium_replace_modem", {
        description: "Replace an owned proxy with a different one chosen by the backend (the carrier can differ). The new proxy has a new host and new credentials, and the old one is released. Each replacement uses one of the account's daily replacements (2 per rolling 24 hours by default; the backend refuses when none are left). Some rental types cannot be replaced (HTTP 409). Requires explicit authorization; never use it as automatic recovery or because a rotation is pending.",
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "POST /modems/:modem_id/replace"],
        run: async ({proxy}) => {
            const id = await resolveProxyId(proxy);
            return withModemLock(id, async () => ({response: await api.post(`/modems/${id}/replace`, {}, {timeoutMs: config.actionTimeoutMs})}));
        },
    });
    registerTool(server, "coronium_get_openvpn_config", {
        description: "Download an owned proxy's OpenVPN profile when its capabilities allow it. The profile contains secrets; return it only to the owner. Some rentals allow one download only (a second call answers 409 until the profile is revoked), and others issue a new certificate on every call, so call it once and keep the result.",
        input: {proxy: proxyField}, access: "write",
        routes: ["GET /account/proxies", "GET /modems/:modem_id/openvpn"],
        run: async ({proxy}) => ({configuration: await api.get(`/modems/${await resolveProxyId(proxy)}/openvpn`, undefined, {text: true, mutates: true})}),
    });
    registerRotationTools(server);
    registerSettingsTools(server);
    registerCancellationTools(server);
}
