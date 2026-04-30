// Proxy lifecycle tools — the bulk of daily-ops surface for an agent.
//
// Naming follows coronium_<verb>_modem so the existing v1.x tools
// (coronium_get_proxies, coronium_rotate_modem) keep working while new
// verbs slot in cleanly. Aliases for the snake_case "action_object"
// pattern used by the wallet-bound MCP at @coronium/mcp are NOT added
// here to avoid duplicate-tool noise — agents can call either MCP and
// get a similar surface, but the prefix differs by intent.

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {ok, err, formatProxyDetail, formatProxyLine, maskUrl, unwrap} from "../formatters.js";
import axios from "axios";

const proxyIdField = z.string().describe("Modem _id (24-char hex) or portId/name (e.g. cor_PL_181fd3aa).");

async function resolveProxyId(idOrName: string, token?: string): Promise<{_id: string, raw: any}> {
    // If the caller passed a 24-char hex, use it directly.
    if (/^[a-f0-9]{24}$/i.test(idOrName)) {
        return {_id: idOrName, raw: null};
    }
    // Otherwise look up by name/portId in the proxies list.
    const list = unwrap<any[]>(await api.get("/account/proxies", undefined, token));
    const match = (list || []).find((p: any) => p.name === idOrName || p.portId === idOrName);
    if (!match) throw new Error(`No proxy with name or portId "${idOrName}". Try coronium_get_proxies to list yours.`);
    return {_id: match._id, raw: match};
}

export function registerProxyTools(server: McpServer) {

    server.tool(
        "coronium_get_proxies",
        "List the user's mobile proxies. Returns one line per proxy with name, host:port, login, expiry, country.",
        {
            country_code: z.string().length(2).optional().describe("ISO-2 filter, e.g. PL, US."),
            online_only: z.boolean().optional().describe("Only return modems currently online."),
            expiring_within_days: z.number().int().positive().optional().describe("Only return modems whose tariff expires within N days."),
        },
        async ({country_code, online_only, expiring_within_days}) => {
            try {
                let list = unwrap<any[]>(await api.get("/account/proxies"));
                if (!Array.isArray(list)) return err("Unexpected response shape from /account/proxies.");
                if (country_code) list = list.filter(p => (p.country?.country_code || p.country_code) === country_code.toUpperCase());
                if (online_only) list = list.filter(p => p.isOnline);
                if (expiring_within_days != null) {
                    const cutoff = Date.now() + expiring_within_days * 86400_000;
                    list = list.filter(p => p.tariff_expired_at && p.tariff_expired_at <= cutoff);
                }
                if (list.length === 0) return ok("No proxies match the filters.");
                return ok(`${list.length} proxies:\n` + list.map(formatProxyLine).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_proxy",
        "Get full details for a single proxy by id or name. Includes credentials, expiry, external IP, rotation interval.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const list = unwrap<any[]>(await api.get("/account/proxies"));
                const match = (list || []).find((p: any) => p._id === proxy || p.name === proxy || p.portId === proxy);
                if (!match) return err(`No proxy "${proxy}".`);
                return ok(formatProxyDetail(match));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_restart_modem",
        "Trigger a rotation (new IP) on the customer's modem via authenticated /v3 endpoint. Idempotent in-flight: if a rotation is already pending, returns its status. Use coronium_get_rotation_status to poll.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.post(`/modems/${_id}/restart`);
                return ok(`✓ Rotation queued for ${proxy}\n  ${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_rotation_status",
        "Poll rotation status for a modem. Returns idle | rotating | success | failed plus the current and previous external IPs. Backend stuck-rotation janitor (deployed 2026-04-30) auto-clears stale 'rotating' states within 5 min.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.get(`/modems/${_id}/rotation-status`);
                return ok(JSON.stringify(r, null, 2));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_rotate_modem",
        "Token-based rotation via the public reset service (default https://mreset.xyz). Doesn't require an API token — uses the per-modem rotation token embedded in the proxy record. Optionally polls until completion.",
        {
            proxy_identifier: z.string().describe("Modem name, portId, _id, or rotation token (UUID)."),
            wait_for_completion: z.boolean().optional().default(true),
            max_wait_time: z.number().int().positive().optional().default(30_000),
        },
        async ({proxy_identifier, wait_for_completion, max_wait_time}) => {
            try {
                // If it looks like a UUID rotation token, hit the reset URL directly. Otherwise, look up the modem and fetch its restartByToken/rotationToken.
                let restartUrl: string | undefined;
                let statusUrl: string | undefined;
                let modemLabel = proxy_identifier;
                if (/^[a-f0-9-]{32,}$/i.test(proxy_identifier)) {
                    restartUrl = `${config.rotationServiceUrl}/restart-modem/${proxy_identifier}`;
                    statusUrl = `${config.rotationServiceUrl}/get-modem-status/${proxy_identifier}`;
                } else {
                    const list = unwrap<any[]>(await api.get("/account/proxies"));
                    const m = (list || []).find((p: any) => p.name === proxy_identifier || p.portId === proxy_identifier || p._id === proxy_identifier);
                    if (!m) return err(`No proxy "${proxy_identifier}".`);
                    modemLabel = m.name || m.portId;
                    const tok = m.restart_token || m.rotationToken || m.proxy?.restartByToken;
                    if (!tok) return err(`Proxy "${modemLabel}" has no rotation token. Use coronium_restart_modem (authenticated) instead.`);
                    restartUrl = `${config.rotationServiceUrl}/restart-modem/${tok}`;
                    statusUrl = `${config.rotationServiceUrl}/get-modem-status/${tok}`;
                }

                const start = Date.now();
                await axios.get(restartUrl, {timeout: 15_000});
                if (!wait_for_completion) {
                    return ok(`✓ Rotation triggered for ${modemLabel} via ${maskUrl(restartUrl)}. Not waiting for completion.`);
                }
                while (Date.now() - start < max_wait_time) {
                    await new Promise(r => setTimeout(r, 2_000));
                    try {
                        const sr = await axios.get(statusUrl!, {timeout: 8_000});
                        const body = String(sr.data || "").toLowerCase();
                        if (body.includes("success") || body.includes("complete") || body.includes("rotated")) {
                            return ok(`✓ Rotation completed for ${modemLabel} (${Math.round((Date.now() - start) / 1000)}s)`);
                        }
                        if (body.includes("error") || body.includes("fail")) {
                            return err(`Rotation reported failure for ${modemLabel}: ${String(sr.data).slice(0, 200)}`);
                        }
                    } catch { /* keep polling */ }
                }
                return ok(`Rotation triggered for ${modemLabel}; status still pending after ${Math.round(max_wait_time / 1000)}s. Use coronium_get_rotation_status to keep polling.`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_test_modem",
        "Test connectivity through a proxy. Sends a request through the modem's HTTP/SOCKS endpoint and returns the observed external IP plus latency.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.post(`/modems/${_id}/test`);
                return ok(typeof r === "string" ? r : JSON.stringify(r, null, 2));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_replace_modem",
        "Swap a broken/dead modem for a working one of the same country/tariff. Used when a modem has consecutive ping failures or won't rotate. Subscription transfers — you keep the same expiry. Requires existing-customer auth.",
        {
            proxy: proxyIdField,
            same_country: z.boolean().optional().default(true).describe("If true, refuse the swap unless replacement stock exists in the same country."),
        },
        async ({proxy, same_country}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.post(`/modems/${_id}/replace`, {same_country});
                return ok(`✓ Replacement queued for ${proxy}\n  ${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_set_rotation_interval",
        "Configure auto-rotation cadence (in seconds). 0 disables auto-rotate. Typical values: 60 (1 min), 300 (5 min), 1800 (30 min). Backend Rotator service polls and triggers per this interval.",
        {
            proxy: proxyIdField,
            interval_seconds: z.number().int().min(0).max(86_400).describe("Seconds between auto-rotations. 0 = manual only."),
        },
        async ({proxy, interval_seconds}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                await api.put(`/modems/${_id}/set-rotation-interval`, {rotation_interval: interval_seconds});
                return ok(`✓ Auto-rotation set to every ${interval_seconds}s for ${proxy}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_change_proxy_password",
        "Rotate the HTTP/SOCKS proxy password. Generates a new random password server-side and returns it.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.put(`/modems/${_id}/change-password`);
                return ok(`✓ Password rotated for ${proxy}\n  new credentials: ${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_set_modem_metadata",
        "Set a free-form metadata note on a modem (e.g. 'production-fb-account-X'). Visible only to the owner; useful for tagging proxies in agent workflows.",
        {
            proxy: proxyIdField,
            metadata: z.string().max(200).describe("Free-form string, ≤200 chars."),
        },
        async ({proxy, metadata}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                await api.put(`/modems/${_id}/set-metadata`, {metadata});
                return ok(`✓ Metadata set for ${proxy}.`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_set_modem_os",
        "Set the p0f OS fingerprint preset (Android / iOS / Windows / etc) the modem should advertise. Useful when the destination platform fingerprints clients.",
        {
            proxy: proxyIdField,
            os: z.string().describe("Preset name. Common: 'android', 'ios', 'windows', 'linux', 'macos', 'auto', or 'off'."),
        },
        async ({proxy, os}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                await api.put(`/modems/${_id}/set-os`, {os});
                return ok(`✓ p0f OS preset set to "${os}" for ${proxy}.`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_cancel_modem",
        "Cancel a modem subscription (no further auto-renew). The modem remains usable until its current tariff_expired_at. Refund policy applies per terms.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.post(`/modems/${_id}/cancel`);
                return ok(`✓ Cancellation requested for ${proxy}\n  ${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_openvpn_config",
        "Get the OpenVPN config blob for a modem. Some modems offer VPN tunnel access in addition to HTTP/SOCKS proxy; this returns the .ovpn content.",
        {proxy: proxyIdField},
        async ({proxy}) => {
            try {
                const {_id} = await resolveProxyId(proxy);
                const r = await api.get(`/modems/${_id}/openvpn`);
                return ok(typeof r === "string" ? r : JSON.stringify(r, null, 2));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );
}
