// Shop tools — browse stock, list tariffs, validate coupons, buy and
// renew. Buying defaults to crypto balance; we expose card-based checkout
// indirectly (the customer can call coronium_get_credit_cards and use the
// frontend if the card flow is preferred — Stripe-saved-card endpoints
// require additional 3DS state we don't replicate in MCP).

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {ok, err, unwrap} from "../formatters.js";

export function registerShopTools(server: McpServer) {
    server.tool(
        "coronium_list_countries",
        "List countries that have stock available. Returns ISO-2 + display name + count of free modems.",
        {},
        async () => {
            try {
                const data = unwrap<any[]>(await api.pub("GET", "/countries"));
                if (!Array.isArray(data) || data.length === 0) return ok("No countries returned.");
                return ok(data.map((c: any) => `  ${c.country_code || c.code} — ${c.name}${c.free_count != null ? ` (${c.free_count} free)` : ""}`).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_list_tariffs",
        "List available tariffs (price plans). Each entry has duration, price, supported countries, included GB. Use coronium_check_coupon before buying for coupon validation.",
        {
            country_code: z.string().length(2).optional().describe("Filter to tariffs offered in this country."),
        },
        async ({country_code}) => {
            try {
                let list = unwrap<any[]>(await api.pub("GET", "/tariffs/available"));
                if (!Array.isArray(list)) return err("Unexpected response from /tariffs/available.");
                if (country_code) {
                    const cc = country_code.toUpperCase();
                    list = list.filter((t: any) => t.country_code === cc || (t.countries || []).some((c: any) => (c.country_code || c.code) === cc));
                }
                if (list.length === 0) return ok("No tariffs match.");
                return ok(list.map((t: any) => {
                    const period = t.period || t.duration || "?";
                    const price = t.price ?? t.price_usd ?? "?";
                    const stock = t.stock != null ? ` | stock=${t.stock}` : "";
                    const cc = t.country_code || "?";
                    const carrier = t.carrier_name ? ` | carrier=${t.carrier_name}` : "";
                    return `  ${t._id || t.id} — ${t.name} | ${cc} | ${period} | $${price}${carrier}${stock}`;
                }).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_list_free_modems",
        "List free (purchasable) modems available right now. Useful before buying — confirms the country/tariff combination has live stock.",
        {
            country_code: z.string().length(2).optional(),
        },
        async ({country_code}) => {
            try {
                const params: any = {};
                if (country_code) params.country_code = country_code.toUpperCase();
                const list = unwrap<any[]>(await api.pub("GET", "/free-modems", undefined, params));
                if (!Array.isArray(list) || list.length === 0) return ok("No free modems available with those filters.");
                return ok(`${list.length} stock buckets:\n` + list.slice(0, 50).map((m: any) => `  country_id=${m.country_id || "?"} carrier=${m.carrier_id || "—"} region=${m.region_id || "—"} count=${m.count}`).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_check_coupon",
        "Validate a coupon code. Returns the discount %, fixed-amount, or error if invalid/expired.",
        {
            code: z.string().min(1),
        },
        async ({code}) => {
            try {
                const r = await api.post("/coupons/check", {code});
                return ok(JSON.stringify(r, null, 2));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_buy_modems_with_balance",
        "Buy one or more modems using account_credit (USD wallet balance). Specify a tariff_id and quantity. Optionally include a coupon. Modems are auto-assigned from free stock matching the tariff's country pool.",
        {
            tariff_id: z.string().describe("Tariff _id from coronium_list_tariffs."),
            quantity: z.number().int().positive().max(50).default(1),
            country_code: z.string().length(2).optional().describe("ISO-2 to constrain the assigned modems."),
            coupon: z.string().optional(),
        },
        async ({tariff_id, quantity, country_code, coupon}) => {
            try {
                const body: any = {tariff_id, count: quantity};
                if (country_code) body.country_code = country_code.toUpperCase();
                if (coupon) body.coupon = coupon;
                const r = await api.post("/payment/buy-modems-with-crypto-balance", body);
                return ok(`✓ Purchase requested\n${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_renew_modems_with_balance",
        "Renew one or more existing modems for an additional tariff period using account_credit.",
        {
            modem_ids: z.array(z.string()).min(1).describe("Array of modem _id values."),
            tariff_id: z.string().describe("Tariff _id to renew under (typically the existing one)."),
            coupon: z.string().optional(),
        },
        async ({modem_ids, tariff_id, coupon}) => {
            try {
                const body: any = {modem_ids, tariff_id};
                if (coupon) body.coupon = coupon;
                const r = await api.post("/payment/renew-modems-with-crypto-balance", body);
                return ok(`✓ Renewal requested\n${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_payment_status",
        "Check the status of a payment by id. Useful after coronium_buy_modems_with_balance / coronium_renew_modems_with_balance to confirm settlement.",
        {
            payment_id: z.string(),
        },
        async ({payment_id}) => {
            try {
                const r = await api.get(`/payments/${payment_id}/status`);
                return ok(JSON.stringify(r, null, 2));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );
}
