import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {CoroniumError} from "../errors.js";
import {arrayResponse, finiteNumber, planName} from "../formatters.js";
import {confirmation, countrySchema, expectedTotalField, idSchema, paymentFields, registerTool} from "../tool.js";

const shortString = z.string().min(1).max(64);
const poolParameters = {
    country: countrySchema.optional(), pool: z.enum(["mbl", "peer", "any", "best"]).default("any"),
    rotation: z.enum(["auto5", "auto10", "auto20", "auto60", "ondemand", "sticky", "hard"]).optional(),
    protocol: z.enum(["http", "socks5"]).default("http"), carrier: shortString.optional(), city: shortString.optional(), sid: shortString.optional(),
    count: z.number().int().min(1).max(1000).default(1), sessionPrefix: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
    sessionMode: z.enum(["unique", "same", "random"]).optional(),
    failover: z.enum(["any", "samecountry", "samecarrier", "samenode", "strict"]).optional(),
    ipType: z.enum(["mobile", "residential", "datacenter"]).optional(), asn: z.string().regex(/^\d{1,7}$/).optional(),
    isp: shortString.optional(), ttl: z.number().int().min(60).max(2_592_000).optional(), strict: z.boolean().optional(),
};
type PoolParams = z.infer<z.ZodObject<typeof poolParameters>>;
function validateParameters(params: PoolParams): void {
    if (params.strict && !["sticky", "hard"].includes(params.rotation || "")) {
        throw new CoroniumError({code: "invalid_pool_parameters", message: "strict:true requires rotation:sticky or rotation:hard."});
    }
}

interface PoolPlan {
    _id: string;
    name: string | null;
    type: "pool";
    currency: "USD";
    price: number;
    traffic_cap_gb: number;
    duration_days: number;
    pool_kind: unknown;
}

async function poolPlans(): Promise<PoolPlan[]> {
    const rows = arrayResponse(await api.catalog(), "Public tariff catalog");
    return rows.filter(row => row.type === "pool" && row.deletedAt == null).map(row => ({
        _id: String(row._id), name: planName(row.name), type: "pool", currency: "USD",
        price: finiteNumber(row.price, "Pool price"), traffic_cap_gb: finiteNumber(row.traffic_cap_gb, "Pool traffic cap"),
        duration_days: finiteNumber(row.duration_days, "Pool duration"), pool_kind: row.pool_kind ?? null,
    }));
}

// Re-read the plan price right before spending; refuse only when it went up.
async function assertPoolPriceWithinApproval(tariffId: string, approvedUsd: number): Promise<void> {
    const plan = (await poolPlans()).find(row => row._id === tariffId);
    if (!plan) throw new CoroniumError({code: "tariff_unavailable", message: "That pool plan is not in the current catalog.", suggested_action: "list_pool_tariffs"});
    if (plan.price <= approvedUsd + 0.005) return;
    throw new CoroniumError({code: "price_changed",
        message: `The plan now costs $${plan.price.toFixed(2)}, higher than the $${approvedUsd.toFixed(2)} the user approved. Nothing was charged.`,
        suggested_action: "requote_and_confirm"});
}

export function registerPoolTools(server: McpServer): void {
    registerTool(server, "coronium_list_pool_tariffs", {
        description: "Discover current pay-per-GB plans from the existing public catalog. Returns only pool plan IDs, names, USD prices, traffic caps and duration; no modem tariffs or internal billing fields. Stock is a separate query.",
        input: {}, routes: ["GET /api/v1/tariffs"],
        run: async () => {
            const tariffs = await poolPlans();
            return {tariffs, count: tariffs.length};
        },
    });
    registerTool(server, "coronium_get_pool_stock", {
        description: "Read pool country stock and any freshness/unavailability indicators. An unavailable upstream is not zero stock or a guarantee that a location is serviceable.",
        input: {}, routes: ["GET /pool/stock"], run: async () => ({response: await api.get("/pool/stock")}),
    });
    registerTool(server, "coronium_get_pool_carriers", {
        description: "Read current pool carrier stock for a two-letter country code.",
        input: {country: countrySchema}, routes: ["GET /pool/stock/carriers/:country"], run: async ({country}) => ({response: await api.get(`/pool/stock/carriers/${country.toLowerCase()}`)}),
    });
    registerTool(server, "coronium_list_pool_keys", {
        description: "List owned pool keys with cap, used traffic, computed remaining GB, expiry and usage freshness. This backend GET may refresh usage in the database and is excluded from strict read-only mode. Remaining traffic is a snapshot, not a live metering guarantee.",
        input: {}, access: "write", routes: ["GET /account/pool-keys"],
        run: async () => {
            const keys = arrayResponse(await api.get("/account/pool-keys", undefined, {mutates: true}), "Pool keys").map(key => {
                const cap = finiteNumber(key.traffic_cap_gb, "Pool cap");
                const used = finiteNumber(key.traffic_used_gb, "Pool usage");
                return {...key, traffic_remaining_gb: Math.max(0, cap - used)};
            });
            return {keys, count: keys.length};
        },
    });
    registerTool(server, "coronium_build_pool_proxy_url", {
        description: "Build credential-bearing URLs for an active owned pool key. Supports protocol, country/carrier/city, session mode, failover and targeting. Building does not prove a connection works. state targeting is intentionally absent because the deployed builder ignores it. Do not expose URLs publicly.",
        input: {id: idSchema, ...poolParameters}, access: "write", routes: ["POST /account/pool-keys/:id/proxy-url"],
        run: async ({id, ...params}) => { validateParameters(params); return {response: await api.post(`/account/pool-keys/${id}/proxy-url`, params)}; },
    });
    registerTool(server, "coronium_buy_pool_with_balance", {
        description: "SPENDS MONEY. Buy a pay-per-GB pool key with USD account credit. Pick a current plan from list_pool_tariffs, show its price and get an explicit yes, then pass that price as expected_total_usd: the tool refuses if the price is now higher. Preserve the idempotency key and the whole receipt.",
        input: {tariff_id: idSchema, expected_total_usd: expectedTotalField, ...paymentFields}, access: "write", money: "spends",
        routes: ["GET /api/v1/tariffs", "POST /payment/buy-pool-with-account-credit"],
        run: async ({tariff_id, expected_total_usd, idempotency_key}) => {
            await assertPoolPriceWithinApproval(tariff_id, expected_total_usd);
            return {funding_source: "account_credit", ...await api.payment("/payment/buy-pool-with-account-credit", {tariff_id}, idempotency_key)};
        },
    });
    registerTool(server, "coronium_topup_pool_key", {
        description: "SPENDS MONEY. Top up an owned pool key with a pool plan, paid from USD account credit. Show the plan price and get an explicit yes, then pass it as expected_total_usd: the tool refuses if the price is now higher. Retain the idempotency key.",
        input: {id: idSchema, tariff_id: idSchema, expected_total_usd: expectedTotalField, ...paymentFields}, access: "write", money: "spends",
        routes: ["GET /api/v1/tariffs", "POST /account/pool-keys/:id/topup"],
        run: async ({id, tariff_id, expected_total_usd, idempotency_key}) => {
            await assertPoolPriceWithinApproval(tariff_id, expected_total_usd);
            return {funding_source: "account_credit", ...await api.payment(`/account/pool-keys/${id}/topup`, {tariff_id}, idempotency_key)};
        },
    });
    registerTool(server, "coronium_cancel_pool_key", {
        description: "Cancel an owned pool key immediately and refund unused traffic pro rata to account credit. URLs using this key stop working. Requires explicit authorization for cancellation and a stable idempotency key.",
        input: {id: idSchema, ...paymentFields, confirm: confirmation}, access: "write", money: "refunds", destructive: true,
        routes: ["POST /account/pool-keys/:id/cancel"],
        run: async ({id, idempotency_key}) => api.payment(`/account/pool-keys/${id}/cancel`, {}, idempotency_key),
    });
    registerTool(server, "coronium_list_pool_sessions", {
        description: "Read active pool sessions visible to this account, preserving backend scope and freshness metadata. Sessions without a user-scoped ID may not be visible.",
        input: {}, routes: ["GET /account/pool/sessions"], run: async () => ({response: await api.get("/account/pool/sessions")}),
    });
    registerTool(server, "coronium_close_pool_session", {
        description: "Close one exact pool session, or explicitly set all_sessions:true to close all sessions visible to this account. This disrupts active connections. Omitting both selectors is rejected.",
        input: {session_key: z.string().min(1).max(256).optional(), all_sessions: z.literal(true).optional(), confirm: confirmation}, access: "write", destructive: true,
        routes: ["DELETE /account/pool/sessions/:sessionKey", "DELETE /account/pool/sessions"],
        run: async ({session_key, all_sessions}) => {
            if (Boolean(session_key) === Boolean(all_sessions)) throw new CoroniumError({code: "session_selector_required", message: "Provide exactly one of session_key or all_sessions:true."});
            const path = session_key ? `/account/pool/sessions/${encodeURIComponent(session_key)}` : "/account/pool/sessions";
            return {response: await api.del(path)};
        },
    });
    registerTool(server, "coronium_list_saved_pool_sessions", {
        description: "Read this account's saved pool URL configurations. These are recipes, not necessarily active connections.",
        input: {}, routes: ["GET /account/pool/saved"], run: async () => ({response: await api.get("/account/pool/saved")}),
    });
    registerTool(server, "coronium_save_pool_session", {
        description: "Create or update an owned pool configuration by key and label. Uses the same validated URL parameters as the pool builder; does not purchase traffic.",
        input: {pool_key_id: idSchema, label: shortString, params: z.object(poolParameters).strict()}, access: "write", idempotent: true, routes: ["POST /account/pool/saved"],
        run: async ({pool_key_id, label, params}) => {
            validateParameters(params);
            return {response: await api.post("/account/pool/saved", {poolKeyId: pool_key_id, label, params})};
        },
    });
    registerTool(server, "coronium_delete_saved_pool_session", {
        description: "Delete one saved pool configuration. This deletes the recipe; closing an active connection is a separate action.",
        input: {id: idSchema, confirm: confirmation}, access: "write", destructive: true, idempotent: true, routes: ["DELETE /account/pool/saved/:id"],
        run: async ({id}) => ({response: await api.del(`/account/pool/saved/${id}`)}),
    });
    registerTool(server, "coronium_build_saved_pool_session_url", {
        description: "Build credential-bearing URLs from an owned saved configuration. The backend updates last_used_at. No connectivity test or traffic purchase is performed.",
        input: {id: idSchema}, access: "write", routes: ["POST /account/pool/saved/:id/url"],
        run: async ({id}) => ({response: await api.post(`/account/pool/saved/${id}/url`)}),
    });
}
