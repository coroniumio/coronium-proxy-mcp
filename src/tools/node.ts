import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {proxyField, resolveProxyId} from "../proxies.js";
import {confirmation, registerTool} from "../tool.js";

// Routes that only Coronium Node rentals support. Other proxies answer 404.
const NODE_ONLY = "Only Coronium Node rentals support this; other proxies answer 404.";

const ipAddress = z.string().ip();

export function registerNodeTools(server: McpServer): void {
    registerTool(server, "coronium_set_white_list", {
        description: `Replace the list of client IPs allowed to use an owned proxy without a password. An empty list removes all entries. ${NODE_ONLY}`,
        input: {proxy: proxyField, white_list: z.array(ipAddress).max(100), confirm: confirmation},
        access: "write", destructive: true, idempotent: true,
        routes: ["GET /account/proxies", "PUT /modems/:modem_id/set-white-list"],
        run: async ({proxy, white_list}) => ({response: await api.put(`/modems/${await resolveProxyId(proxy)}/set-white-list`, {white_list})}),
    });
    registerTool(server, "coronium_get_usage", {
        description: `Read traffic usage for an owned proxy over the last N days. ${NODE_ONLY}`,
        input: {proxy: proxyField, days: z.number().int().min(1).max(90).optional()},
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
