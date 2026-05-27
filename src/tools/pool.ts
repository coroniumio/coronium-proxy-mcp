// Pool Gateway tools — Proxies.sx pay-per-GB pool keys & sticky sessions.
// These map to the /account/pool-* and /pool/* v3 endpoints, which return 503
// when POOL_ENABLED is off on the deployment (surfaced as a clear error).

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {ok, err, unwrap} from "../formatters.js";

export function registerPoolTools(server: McpServer) {
    server.tool(
        "coronium_get_pool_stock",
        "Pool Gateway (pay-per-GB): live pool stock availability. Returns 503 if the pool tier is not enabled on this deployment.",
        {},
        async () => {
            try { return ok(JSON.stringify(unwrap(await api.get("/pool/stock")), null, 2)); }
            catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_list_pool_keys",
        "List my pay-per-GB pool keys (status, traffic remaining, tariff). Use coronium_build_pool_proxy_url to get a usable proxy URL for an active key.",
        {},
        async () => {
            try {
                const list = unwrap<any[]>(await api.get("/account/pool-keys"));
                if (!Array.isArray(list) || list.length === 0) return ok("No pool keys.");
                return ok(list.map((k: any) =>
                    `  ${k._id || k.id} — status=${k.status} | tariff=${k.tariff_name || k.tariff_id || "?"} | gb_left=${k.traffic_remaining_gb ?? k.gb_remaining ?? "?"}`).join("\n"));
            } catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_build_pool_proxy_url",
        "Build a usable proxy URL (or URLs) for an active pool key. Returns host gw.proxies.sx + credentials. Optional protocol (http|socks5), count, and country targeting.",
        {
            id: z.string().describe("Pool key id"),
            protocol: z.enum(["http", "socks5"]).optional(),
            count: z.number().int().positive().optional().describe("How many URLs to generate"),
            country: z.string().optional().describe("ISO-2 country to target, if supported by the key"),
        },
        async ({id, protocol, count, country}) => {
            try {
                const body: any = {};
                if (protocol) body.protocol = protocol;
                if (count) body.count = count;
                if (country) body.country = country;
                return ok(JSON.stringify(unwrap(await api.post(`/account/pool-keys/${id}/proxy-url`, body)), null, 2));
            } catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_topup_pool_key",
        "Top up (add traffic/credit to) an existing pool key.",
        {id: z.string().describe("Pool key id")},
        async ({id}) => {
            try { return ok(JSON.stringify(unwrap(await api.post(`/account/pool-keys/${id}/topup`, {})), null, 2)); }
            catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_cancel_pool_key",
        "Cancel a pool key.",
        {id: z.string().describe("Pool key id")},
        async ({id}) => {
            try { return ok(JSON.stringify(unwrap(await api.post(`/account/pool-keys/${id}/cancel`, {})), null, 2)); }
            catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_buy_pool_with_balance",
        "Buy a pay-per-GB pool key using account balance. Pass a pool tariff_id (from coronium_list_tariffs; pool tariffs have a traffic cap).",
        {tariff_id: z.string().describe("A pool tariff id")},
        async ({tariff_id}) => {
            try { return ok(JSON.stringify(unwrap(await api.post("/payment/buy-pool-with-account-credit", {tariff_id})), null, 2)); }
            catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_list_pool_sessions",
        "List my currently-open sticky pool sessions.",
        {},
        async () => {
            try {
                const list = unwrap<any[]>(await api.get("/account/pool/sessions"));
                if (!Array.isArray(list) || list.length === 0) return ok("No open pool sessions.");
                return ok(JSON.stringify(list, null, 2));
            } catch (e: any) { return err(e.message); }
        }
    );

    server.tool(
        "coronium_close_pool_session",
        "Close a pool session. Pass session_key to close one, or omit it to close ALL of my pool sessions.",
        {session_key: z.string().optional().describe("Session key to close; omit to close all")},
        async ({session_key}) => {
            try {
                const path = session_key ? `/account/pool/sessions/${encodeURIComponent(session_key)}` : "/account/pool/sessions";
                return ok(JSON.stringify(unwrap(await api.del(path)), null, 2));
            } catch (e: any) { return err(e.message); }
        }
    );
}
