import {randomBytes} from "node:crypto";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {CoroniumError, invalidResponse} from "../errors.js";
import {unwrap} from "../formatters.js";
import {findProxy, normalizedProxies, proxyField, resolveProxyId} from "../proxies.js";
import {confirmation, countrySchema, registerTool} from "../tool.js";

async function restart(identifier: string): Promise<Record<string, unknown>> {
    const id = await resolveProxyId(identifier);
    const response = await api.post(`/modems/${id}/restart`, {}, {timeoutMs: config.actionTimeoutMs});
    if (response?.rotated === false) throw new CoroniumError({code: "rotation_failed", message: response.message || "The backend could not verify a new IP.", details: response, suggested_action: "check_rotation_status"});
    if (response?.rotated !== true) invalidResponse("Rotation returned no verified rotated flag. Check rotation status before another action.");
    return {response};
}

export function registerProxyTools(server: McpServer): void {
    registerTool(server, "coronium_get_proxies", {
        description: "List owned proxies with backend credentials, usable HTTP/SOCKS5 URLs, country, expiry and per-modem capabilities. Connection details are sensitive. Listing does not test connectivity or prove SOCKS5 works.",
        input: {country_code: countrySchema.optional(), online_only: z.boolean().optional(), expiring_within_days: z.number().int().positive().optional()},
        run: async ({country_code, online_only, expiring_within_days}) => {
            let proxies = await normalizedProxies();
            if (country_code) proxies = proxies.filter(proxy => proxy.country_code === country_code);
            if (online_only) proxies = proxies.filter(proxy => proxy.isOnline === true);
            if (expiring_within_days !== undefined) {
                const cutoff = Date.now() + expiring_within_days * 86_400_000;
                proxies = proxies.filter(proxy => proxy.tariff_expired_at && Number(proxy.tariff_expired_at) <= cutoff);
            }
            return {proxies, count: proxies.length};
        },
    });
    registerTool(server, "coronium_get_proxy", {
        description: "Read an owned proxy's credentials, URLs, expiry, rotation token and actual backend capability flags. Treat these results as secrets. No connection is tested.",
        input: {proxy: proxyField}, run: async ({proxy}) => ({proxy: findProxy(await normalizedProxies(), proxy)}),
    });
    registerTool(server, "coronium_restart_modem", {
        description: "Rotate an owned modem and wait for the backend's synchronous result. Existing connections may drop. Success requires rotated:true. Do not replace or repeatedly restart after a failure; inspect status first.",
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy}) => restart(proxy),
    });
    registerTool(server, "coronium_rotate_modem", {
        description: "Rotate using an owned modem ID/name, or an explicit UUID rotation token through the Coronium v3 token route. Waits for the backend result; may interrupt connections. No fire-and-forget or substring-based success detection.",
        input: {proxy_identifier: proxyField, confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy_identifier}) => {
            if (!z.string().uuid().safeParse(proxy_identifier).success) return restart(proxy_identifier);
            const response = await api.get(`/modems/rotate-modem-by-token/${encodeURIComponent(proxy_identifier)}`, undefined, {public: true, mutates: true, timeoutMs: config.actionTimeoutMs});
            if (response?.result !== "ok" || !response.new_ip) invalidResponse("Token rotation returned no confirmed new IP. Check state before retrying.");
            return {response};
        },
    });
    registerTool(server, "coronium_get_rotation_status", {
        description: "Read rotation state: idle, rotating, done or failed, plus IP, timing and backend failure details. A pending or idle state does not prove a completed rotation.",
        input: {proxy: proxyField}, run: async ({proxy}) => ({response: await api.get(`/modems/${await resolveProxyId(proxy)}/rotation-status`)}),
    });
    registerTool(server, "coronium_test_modem", {
        description: "Ask the backend to run its connectivity diagnostic. This makes real network traffic; it does not independently verify both HTTP and SOCKS5. Preserve the reported protocol and result; never assume a listed SOCKS port works.",
        input: {proxy: proxyField}, access: "write",
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/test`, {}, {timeoutMs: config.actionTimeoutMs}), independently_verified_protocols: []}),
    });
    registerTool(server, "coronium_replace_modem", {
        description: "Replace an owned proxy through the backend's replacement policy. This can change its credentials, address and assigned modem and disrupt service. Requires explicit authorization; never use as an automatic recovery step.",
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/replace`, {}, {timeoutMs: config.actionTimeoutMs})}),
    });
    registerTool(server, "coronium_set_rotation_interval", {
        description: "Set auto-rotation cadence: 0 disables it, otherwise 60–86400 seconds. Rotation interrupts connections, so changing this requires authorization.",
        input: {proxy: proxyField, interval_seconds: z.number().int().min(0).max(86_400).refine(value => value === 0 || value >= 60, "Use 0 or at least 60 seconds."), confirm: confirmation},
        access: "write", destructive: true, idempotent: true,
        run: async ({proxy, interval_seconds}) => ({response: await api.put(`/modems/${await resolveProxyId(proxy)}/set-rotation-interval`, {rotation_interval: interval_seconds})}),
    });
    registerTool(server, "coronium_change_proxy_password", {
        description: "Change an owned proxy's password, invalidating its previous credentials. Supply at least 6 characters, or omit to generate a cryptographically random password in this MCP process. The password is sent explicitly to the backend.",
        input: {proxy: proxyField, proxy_password: z.string().min(6).max(128).optional(), confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy, proxy_password}) => {
            const password = proxy_password || randomBytes(24).toString("base64url");
            const response = await api.put(`/modems/${await resolveProxyId(proxy)}/change-password`, {proxy_password: password});
            return {response, proxy_password: password};
        },
    });
    registerTool(server, "coronium_set_modem_metadata", {
        description: "Set a private owner note. Objects are JSON-serialized to the backend's metadata string; this does not rename hardware or change ports.",
        input: {proxy: proxyField, metadata: z.union([z.string().max(8000), z.record(z.unknown())])}, access: "write", idempotent: true,
        run: async ({proxy, metadata}) => ({response: await api.put(`/modems/${await resolveProxyId(proxy)}/set-metadata`, {metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata)})}),
    });
    registerTool(server, "coronium_get_p0f_options", {
        description: "Read per-modem/provider support, accepted OS presets and cooldown. Use these actual options before setting an OS; capabilities differ by server.",
        input: {proxy: proxyField}, run: async ({proxy}) => ({response: await api.get(`/modems/${await resolveProxyId(proxy)}/p0f-options`)}),
    });
    registerTool(server, "coronium_set_modem_os", {
        description: "Set an OS preset from this modem's p0f-options response, or empty string to disable spoofing when supported. Checks capability first. May reapply settings and interrupt connections.",
        input: {proxy: proxyField, os: z.string().max(128), confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy, os}) => {
            const id = await resolveProxyId(proxy);
            const options = unwrap(await api.get(`/modems/${id}/p0f-options`));
            if (!options?.supported || !Array.isArray(options.options) || (os !== "" && !options.options.includes(os))) {
                throw new CoroniumError({code: "unsupported_os", message: "This modem does not advertise support for that OS preset.", details: options, suggested_action: "get_p0f_options"});
            }
            return {response: await api.put(`/modems/${id}/set-os`, {os})};
        },
    });
    registerTool(server, "coronium_preview_modem_cancellation", {
        description: "Preview the backend's refund calculation using dryRun:true. Does not cancel, release or alter the modem. Read this before requesting authorization for immediate cancellation.",
        input: {proxy: proxyField},
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/cancel`, {dryRun: true}, {readOnly: true})}),
    });
    registerTool(server, "coronium_cancel_modem", {
        description: "IMMEDIATELY cancel and release an owned proxy, applying the backend's refund policy. Access ends now, even when no refund is due. This does NOT merely disable auto-renew. Preview first and obtain explicit authorization for losing this proxy.",
        input: {proxy: proxyField, reason: z.string().max(2000).optional(), confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy, reason}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/cancel`, {reason}, {timeoutMs: config.actionTimeoutMs})}),
    });
    registerTool(server, "coronium_get_openvpn_config", {
        description: "Download the owned modem's OpenVPN configuration when its backend capabilities allow it. The configuration contains secrets; return it only to the owner.",
        input: {proxy: proxyField},
        run: async ({proxy}) => ({configuration: await api.get(`/modems/${await resolveProxyId(proxy)}/openvpn`, undefined, {text: true})}),
    });
    registerTool(server, "coronium_get_proxy_health", {
        description: "Read the backend health snapshot for owned proxies. It is evidence for diagnosis, not authorization to replace, release or reconfigure a modem, and does not prove all protocols work.",
        input: {}, run: async () => ({response: await api.get("/account/proxies/health")}),
    });
    registerTool(server, "coronium_apply_modem_settings", {
        description: "Ask the backend to reapply an owned proxy's current settings. May interrupt connections. Requires explicit authorization; never issue broad server or port repairs.",
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/apply-settings`, {}, {timeoutMs: config.actionTimeoutMs})}),
    });
}
