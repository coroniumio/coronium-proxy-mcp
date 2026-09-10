import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api, type ApiObject} from "../api-client.js";
import {CoroniumError, invalidResponse} from "../errors.js";
import {arrayResponse} from "../formatters.js";
import {countrySchema, idSchema, paymentFields, registerTool} from "../tool.js";

const couponField = z.string().min(1).max(128).optional();
const fundingSource = z.enum(["account_credit", "btc"]).default("account_credit").describe("Choose explicitly: USD account credit or native BTC. USDT and cards are not supported by these MCP checkout tools.");
const renewalFields = {
    modems: z.array(z.object({modem_id: idSchema, days: z.number().int().min(1).max(90)}).strict()).min(1).max(100)
        .refine(rows => new Set(rows.map(row => row.modem_id)).size === rows.length, "Each modem must appear only once."),
    coupon: couponField,
};

function couponBody(coupon?: string): Record<string, unknown> {
    return coupon ? {coupon: {coupon_name: coupon}} : {};
}

async function renewalQuote(modems: {modem_id: string; days: number}[], coupon?: string): Promise<ApiObject> {
    const quote = await api.post("/payment/renewal-quote", {modems, ...couponBody(coupon)}, {readOnly: true});
    const lines = quote?.line_items;
    // The deployed quote handler filters unowned IDs. Never silently submit a
    // partially quoted basket or infer that omitted modems can be renewed.
    if (!Array.isArray(lines) || modems.some(modem => !lines.some(line => String(line.modem_id) === modem.modem_id))) {
        throw new CoroniumError({code: "incomplete_renewal_quote", message: "The backend did not quote every requested modem. Verify ownership and request a complete quote before renewing.", suggested_action: "list_owned_proxies"});
    }
    if (typeof quote.total_usd !== "number" || !Number.isFinite(quote.total_usd)) invalidResponse("Renewal quote is missing its USD total.");
    return quote;
}

export function registerShopTools(server: McpServer): void {
    registerTool(server, "coronium_list_countries", {
        description: "Read the public country and carrier catalog. Presence in the catalog does not mean purchasable stock; check list_tariffs for current availability.",
        input: {}, run: async () => ({countries: arrayResponse(await api.publicGet("/countries"), "Countries")}),
    });
    registerTool(server, "coronium_list_tariffs", {
        description: "Read available modem plans with backend stock, price, period, country, carrier and capabilities. Stock is a snapshot and can change before checkout; multiple plans may share the same modems. Use list_pool_tariffs for pay-per-GB plans.",
        input: {country_code: countrySchema.optional(), carrier_id: idSchema.optional()},
        run: async ({country_code, carrier_id}) => {
            const response = await api.publicGet("/tariffs/available");
            let tariffs = arrayResponse(response, "Available tariffs");
            if (country_code) tariffs = tariffs.filter(tariff => tariff.country_code === country_code);
            if (carrier_id) tariffs = tariffs.filter(tariff => String(tariff.carrier_id) === carrier_id);
            return {tariffs, count: tariffs.length, cached: response._cached ?? null, age_ms: response._ageMs ?? null};
        },
    });
    registerTool(server, "coronium_list_free_modems", {
        description: "Read aggregate free modem stock by country/carrier/region, with optional country filtering. Counts are backend snapshots, not reservations or connectivity tests.",
        input: {country_code: countrySchema.optional()},
        run: async ({country_code}) => {
            const [stockResponse, countriesResponse] = await Promise.all([api.publicGet("/free-modems"), api.publicGet("/countries")]);
            const countries = arrayResponse(countriesResponse, "Countries");
            let stock = arrayResponse(stockResponse, "Free modem stock").map(row => ({...row, country_code: countries.find(country => String(country._id) === String(row.country_id))?.country_code ?? null}));
            if (country_code) stock = stock.filter(row => row.country_code === country_code);
            return {stock};
        },
    });
    registerTool(server, "coronium_check_coupon", {
        description: "Validate a coupon using the backend's coupon_name field. This is a read-only POST. The eventual server quote/receipt determines any discount.",
        input: {code: z.string().min(1).max(128)},
        run: async ({code}) => ({response: await api.post("/coupons/check", {coupon_name: code}, {readOnly: true})}),
    });
    registerTool(server, "coronium_buy_modems_with_balance", {
        description: "Spend account credit (USD, default) or BTC to buy a current modem tariff. Read plan/stock and balance first, then obtain authorization for the funding source, quantity and price. Backend pricing is authoritative. Preserve the idempotency key and complete receipt; no automatic write retries or substitute purchases.",
        input: {tariff_id: idSchema, quantity: z.number().int().min(1).max(100), funding_source: fundingSource,
            country_code: countrySchema.optional().describe("Optional guard: refuse if this does not match the selected tariff's country."),
            metadata: z.union([z.string().max(8000), z.record(z.unknown())]).optional(), coupon: couponField, want_p0f: z.boolean().optional(), ...paymentFields},
        access: "write",
        run: async ({tariff_id, quantity, funding_source, country_code, metadata, coupon, want_p0f, idempotency_key}) => {
            const tariffs = arrayResponse(await api.publicGet("/tariffs/available"), "Available tariffs");
            const tariff = tariffs.find(row => String(row._id) === tariff_id);
            if (!tariff || (country_code && tariff.country_code !== country_code)) throw new CoroniumError({code: "tariff_unavailable", message: "The tariff is unavailable or does not match the requested country.", suggested_action: "list_tariffs"});
            if (typeof tariff.stock !== "number" || tariff.stock < quantity) throw new CoroniumError({code: "insufficient_stock", message: "The current stock snapshot cannot satisfy this quantity.", suggested_action: "list_tariffs"});
            const body = {tariff_id, modemCount: quantity, ...couponBody(coupon),
                ...(metadata !== undefined ? {metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata)} : {}),
                ...(want_p0f !== undefined ? {wantP0f: want_p0f} : {})};
            const path = funding_source === "btc" ? "/payment/buy-modems-with-crypto-balance" : "/payment/buy-with-account-credit";
            return {funding_source, ...await api.payment(path, body, idempotency_key)};
        },
    });
    registerTool(server, "coronium_get_renewal_quote", {
        description: "Get the backend's authoritative USD renewal quote for owned modem IDs and 1–90 days each. Refuses partial quotes. No money is spent and no subscription changes. Quotes are not price locks.",
        input: renewalFields, run: async ({modems, coupon}) => ({quote: await renewalQuote(modems, coupon)}),
    });
    registerTool(server, "coronium_renew_modems_with_balance", {
        description: "Renew owned modems for specified days using account_credit or btc. Obtain a renewal quote and authorization first. Submits modems:[{modem_id,days}] without a purchase tariff. Preserve the idempotency key and receipt; check payment state after ambiguous failures.",
        input: {...renewalFields, funding_source: fundingSource, ...paymentFields}, access: "write",
        run: async ({modems, coupon, funding_source, idempotency_key}) => {
            const quote = await renewalQuote(modems, coupon);
            const path = funding_source === "btc" ? "/payment/renew-modems-with-crypto-balance" : "/payment/renew-with-account-credit";
            return {funding_source, quote_before_submission: quote, ...await api.payment(path, {modems, ...couponBody(coupon)}, idempotency_key)};
        },
    });
    registerTool(server, "coronium_get_payment_status", {
        description: "Read a payment's current backend status by its ID from a receipt. Keep pending/failed states intact; do not infer provisioning from HTTP success alone.",
        input: {payment_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)},
        run: async ({payment_id}) => ({response: await api.get(`/payments/${encodeURIComponent(payment_id)}/status`)}),
    });
}
