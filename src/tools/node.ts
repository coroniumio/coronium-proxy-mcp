import {isIP} from "node:net";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {proxyField, resolveProxyId} from "../proxies.js";
import {confirmation, registerTool} from "../tool.js";

// Used for the usage, speed test and profile controls specific to Node rentals.
const NODE_ONLY = "Only Coronium Node rentals support this; other proxies answer 404.";

function validWhitelistEntry(input: string): boolean {
    const [address, prefix, extra] = input.split("/");
    const family = isIP(address);
    if (!family || extra !== undefined) return false;
    if (prefix === undefined) return true;
    if (!/^\d{1,3}$/.test(prefix)) return false;
    const bits = Number(prefix);
    return family === 4 ? bits >= 24 && bits <= 32 : bits >= 48 && bits <= 128;
}

const whitelistEntry = z.string().max(64).trim().refine(validWhitelistEntry, {
    message: "Enter an IP address or a CIDR range (IPv4 /24 to /32, IPv6 /48 to /128).",
});

export function registerNodeTools(server: McpServer): void {
    registerTool(server, "coronium_set_white_list", {
        description: "Replace the whitelist on an owned proxy that advertises proxyEndpoints.capabilities.whitelist or features.whitelist.available. Send up to 10 addresses or CIDR ranges (IPv4 /24 to /32, IPv6 /48 to /128). An empty list clears it.",
        input: {proxy: proxyField, white_list: z.array(whitelistEntry).max(10), confirm: confirmation},
        access: "write", destructive: true, idempotent: true,
        routes: ["GET /account/proxies", "PUT /modems/:modem_id/set-white-list"],
        run: async ({proxy, white_list}) => ({response: await api.put(`/modems/${await resolveProxyId(proxy)}/set-white-list`, {white_list})}),
    });
    registerTool(server, "coronium_get_usage", {
        description: `Read traffic usage for the current rental over the last 1 to 366 days (default 30). ${NODE_ONLY}`,
        input: {proxy: proxyField, days: z.number().int().min(1).max(366).optional()},
        routes: ["GET /account/proxies", "GET /modems/:modem_id/usage"],
        run: async ({proxy, days}) => ({response: await api.get(`/modems/${await resolveProxyId(proxy)}/usage`, days === undefined ? undefined : {days})}),
    });
    registerTool(server, "coronium_start_speed_test", {
        description: `Start a speed test on an owned proxy. It uses real traffic and usually finishes later: read the result with get_speed_test. Rate limited; respect retry_after_seconds. ${NODE_ONLY}`,
        input: {proxy: proxyField, confirm: confirmation}, access: "write",
        routes: ["GET /account/proxies", "POST /modems/:modem_id/speed-test"],
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/speed-test`, {}, {timeoutMs: config.actionTimeoutMs})}),
    });
    registerTool(server, "coronium_get_speed_test", {
        description: `Read the latest speed test result for an owned proxy. ${NODE_ONLY}`,
        input: {proxy: proxyField}, routes: ["GET /account/proxies", "GET /modems/:modem_id/speed-test"],
        run: async ({proxy}) => ({response: await api.get(`/modems/${await resolveProxyId(proxy)}/speed-test`)}),
    });
    registerTool(server, "coronium_revoke_openvpn", {
        description: `Revoke an owned proxy's OpenVPN profile so a new one can be downloaded. The old profile stops working. Use it when a one-time download was lost. ${NODE_ONLY}`,
        input: {proxy: proxyField, confirm: confirmation}, access: "write", destructive: true,
        routes: ["GET /account/proxies", "POST /modems/:modem_id/openvpn/revoke"],
        run: async ({proxy}) => ({response: await api.post(`/modems/${await resolveProxyId(proxy)}/openvpn/revoke`)}),
    });
}
