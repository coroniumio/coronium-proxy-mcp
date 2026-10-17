import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api, type ApiObject} from "../api-client.js";
import {CoroniumError, invalidResponse} from "../errors.js";
import {arrayResponse} from "../formatters.js";
import {countrySchema, expectedTotalField, idSchema, paymentFields, registerTool} from "../tool.js";

interface RenewalLine {
    modem_id: string;
    days: number;
}

const PRICE_TOLERANCE_USD = 0.005;
const RECONCILE_STEP = "If this receipt has no payment ID, confirm delivery with coronium_get_proxies and the charge with coronium_get_payments. Never buy again to fix an unclear result; open a ticket quoting the idempotency key and request ID instead.";

const couponField = z.string().min(1).max(128).optional();
const fundingSource = z.enum(["account_credit", "btc"]).describe("Required. account_credit spends USD account credit; btc spends the native BTC balance at the live rate. USDT and cards are not supported by these tools.");
const renewalFields = {
    modems: z.array(z.object({modem_id: idSchema, days: z.number().int().min(1).max(90)}).strict()).min(1).max(100)
        .refine(rows => new Set(rows.map(row => row.modem_id)).size === rows.length, "Each modem must appear only once."),
    coupon: couponField,
};

function couponBody(coupon?: string): Record<string, unknown> {
    return coupon ? {coupon: {coupon_name: coupon}} : {};
}

function roundCents(amount: number): number {
    return Math.round(amount * 100) / 100;
}

// Same formula as the backend: a coupon value is "NN%" or a flat USD amount.
export function applyCoupon(listUsd: number, value: unknown): number {
    const text = String(value ?? "").trim();
    if (text.endsWith("%")) {
        const percent = Number(text.slice(0, -1));
        return roundCents(listUsd * (1 - percent / 100));
    }
    return roundCents(Math.max(0, listUsd - Number(text)));
}

async function couponValue(coupon: string): Promise<unknown> {
    const response = await api.post("/coupons/check", {coupon_name: coupon}, {readOnly: true});
    const discount = response?.data?.discount;
    // Refuse before checkout when the coupon gives no discount, so the user is
    // never charged a total that differs from the one they approved.
    if (discount === undefined || discount === null || discount === "" || discount === 0 || discount === "0") {
        throw new CoroniumError({code: "coupon_invalid", message: "The coupon gives no discount now. Nothing was charged. Ask the user whether to continue without it.", suggested_action: "confirm_without_coupon"});
    }
    return discount;
}

function assertWithinApproval(currentUsd: number, approvedUsd: number): void {
    if (currentUsd <= approvedUsd + PRICE_TOLERANCE_USD) return;
    throw new CoroniumError({code: "price_changed",
        message: `The current total is $${currentUsd.toFixed(2)}, higher than the $${approvedUsd.toFixed(2)} the user approved. Nothing was charged. Show the new total and ask again.`,
        suggested_action: "requote_and_confirm"});
}

function lineMatches(lines: ApiObject[], modem: RenewalLine): boolean {
    return lines.some(line => String(line.modem_id) === modem.modem_id && Number(line.days) === modem.days);
}

async function renewalQuote(modems: RenewalLine[], coupon?: string): Promise<ApiObject> {
    const quote = await api.post("/payment/renewal-quote", {modems, ...couponBody(coupon)}, {readOnly: true});
    const lines = quote?.line_items;
    // The quote handler drops modems it does not recognise. Never submit a
    // partially quoted basket, or one whose days the backend changed.
    if (!Array.isArray(lines) || modems.some(modem => !lineMatches(lines, modem))) {
        throw new CoroniumError({code: "incomplete_renewal_quote", message: "The backend did not quote every requested modem for the requested days. Verify ownership and request a complete quote before renewing.", suggested_action: "list_owned_proxies"});
    }
    if (typeof quote.total_usd !== "number" || !Number.isFinite(quote.total_usd)) invalidResponse("Renewal quote is missing its USD total.");
    return quote;
}

function deliveryReport(receipt: ApiObject, requested: number): Record<string, unknown> {
    const delivered = receipt?.response?.data;
    const deliveredCount = Array.isArray(delivered) ? delivered.length : null;
    return {requested_count: requested, delivered_count: deliveredCount, delivery_verified: deliveredCount === requested, next_step: RECONCILE_STEP};
}

// The pre-check above is client-side, so the result also compares what the
// backend says it charged with what the user approved. A queued payment
// (HTTP 202) has no charged amount yet; that stays null, never "within".
function chargeReport(receipt: ApiObject, approvedUsd: number): Record<string, unknown> {
    const charged: unknown = receipt?.response?.charged_usd;
    if (typeof charged !== "number" || !Number.isFinite(charged)) {
        return {approved_usd: approvedUsd, charged_usd: null, within_approval: null};
    }
    return {approved_usd: approvedUsd, charged_usd: charged, within_approval: charged <= approvedUsd + PRICE_TOLERANCE_USD};
}

async function currentTariff(tariffId: string, quantity: number, countryCode?: string): Promise<ApiObject> {
    const tariffs = arrayResponse(await api.publicGet("/tariffs/available"), "Available tariffs");
    const tariff = tariffs.find(row => String(row._id) === tariffId);
    if (!tariff || (countryCode && tariff.country_code !== countryCode)) {
        throw new CoroniumError({code: "tariff_unavailable", message: "The tariff is unavailable or does not match the requested country.", suggested_action: "list_tariffs"});
    }
    if (typeof tariff.stock !== "number" || tariff.stock < quantity) {
        throw new CoroniumError({code: "insufficient_stock", message: "The current stock snapshot cannot satisfy this quantity.", suggested_action: "list_tariffs"});
    }
    return tariff;
}

async function currentBuyTotal(tariff: ApiObject, quantity: number, coupon?: string): Promise<number> {
    const listUsd = roundCents(Number(tariff.price) * quantity);
    if (!Number.isFinite(listUsd)) invalidResponse("The tariff has no usable price.");
    if (!coupon) return listUsd;
    return applyCoupon(listUsd, await couponValue(coupon));
}

function metadataText(metadata: string | Record<string, unknown>): string {
    return typeof metadata === "string" ? metadata : JSON.stringify(metadata);
}

function registerCatalogTools(server: McpServer): void {
    registerTool(server, "coronium_list_countries", {
        description: "Read the public country and carrier catalog. Presence in the catalog does not mean stock; check list_tariffs for current availability.",
        input: {}, routes: ["GET /countries"],
        run: async () => ({countries: arrayResponse(await api.publicGet("/countries"), "Countries")}),
    });
    registerTool(server, "coronium_list_tariffs", {
        description: "Read available dedicated proxy plans with stock, USD price, period in days, country, carrier and capabilities, optionally filtered by country and carrier. Stock is a snapshot and can change; several plans may share the same proxies. Use list_pool_tariffs for pay-per-GB plans.",
        input: {country_code: countrySchema.optional(), carrier_id: idSchema.optional()}, routes: ["GET /tariffs/available"],
        run: async ({country_code, carrier_id}) => {
            const response = await api.publicGet("/tariffs/available");
            let tariffs = arrayResponse(response, "Available tariffs");
            if (country_code) tariffs = tariffs.filter(tariff => tariff.country_code === country_code);
            if (carrier_id) tariffs = tariffs.filter(tariff => String(tariff.carrier_id) === carrier_id);
            return {tariffs, count: tariffs.length, cached: response._cached ?? null, age_ms: response._ageMs ?? null};
        },
    });
    registerTool(server, "coronium_list_free_modems", {
        description: "Read aggregate stock counts by country, carrier and region, optionally filtered by country and carrier. Counts are snapshots, not reservations or connectivity tests.",
        input: {country_code: countrySchema.optional(), carrier_id: idSchema.optional()}, routes: ["GET /free-modems", "GET /countries"],
        run: async ({country_code, carrier_id}) => {
            const [stockResponse, countriesResponse] = await Promise.all([api.publicGet("/free-modems"), api.publicGet("/countries")]);
            const countries = arrayResponse(countriesResponse, "Countries");
            const codeOf = (countryId: unknown): string | null => countries.find(country => String(country._id) === String(countryId))?.country_code ?? null;
            let stock: ApiObject[] = arrayResponse(stockResponse, "Stock").map(row => ({...row, country_code: codeOf(row.country_id)}));
            if (country_code) stock = stock.filter(row => row.country_code === country_code);
            if (carrier_id) stock = stock.filter(row => String(row.carrier_id) === carrier_id);
            return {stock};
        },
    });
    registerTool(server, "coronium_check_coupon", {
        description: "Check a coupon. This read-only POST changes nothing. The discount is a percentage (\"10%\") or a flat USD amount.",
        input: {code: z.string().min(1).max(128)}, routes: ["POST /coupons/check"],
        run: async ({code}) => ({response: await api.post("/coupons/check", {coupon_name: code}, {readOnly: true})}),
    });
    registerTool(server, "coronium_get_renewal_quote", {
        description: "Get the backend's USD renewal quote for owned proxies (1-90 days each). Refuses partial quotes. Spends nothing and changes nothing. Quotes are not price locks. Payment happens in the dashboard unless spending is enabled in this MCP.",
        input: renewalFields, routes: ["POST /payment/renewal-quote"],
        run: async ({modems, coupon}) => ({quote: await renewalQuote(modems, coupon)}),
    });
    registerTool(server, "coronium_get_payment_status", {
        description: "Read a payment's current status by its ID. Keep pending and failed states as they are; do not infer delivery from HTTP success alone.",
        input: {payment_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)}, routes: ["GET /payments/:id/status"],
        run: async ({payment_id}) => ({response: await api.get(`/payments/${encodeURIComponent(payment_id)}/status`)}),
    });
}

function registerSpendingTools(server: McpServer): void {
    registerTool(server, "coronium_buy_modems_with_balance", {
        description: "SPENDS MONEY. Buy dedicated proxies from account credit or BTC. Read plan, stock and balance first, show the user the plan, quantity, funding source and total, and get an explicit yes. Pass that total as expected_total_usd: the tool re-reads the price and refuses if it is now higher. Preserve the idempotency key and the whole receipt. No automatic retries; after an unclear result, reconcile instead of buying again.",
        input: {tariff_id: idSchema, quantity: z.number().int().min(1).max(100), funding_source: fundingSource, expected_total_usd: expectedTotalField,
            country_code: countrySchema.optional().describe("Optional guard: refuse if this does not match the selected tariff's country."),
            metadata: z.union([z.string().max(8000), z.record(z.unknown())]).optional(), coupon: couponField, want_p0f: z.boolean().optional(), ...paymentFields},
        access: "write", money: "spends",
        routes: ["GET /tariffs/available", "POST /coupons/check", "POST /payment/buy-with-account-credit", "POST /payment/buy-modems-with-crypto-balance"],
        run: async ({tariff_id, quantity, funding_source, expected_total_usd, country_code, metadata, coupon, want_p0f, idempotency_key}) => {
            const tariff = await currentTariff(tariff_id, quantity, country_code);
            assertWithinApproval(await currentBuyTotal(tariff, quantity, coupon), expected_total_usd);
            // A buy sends only the purchase fields, never a renewal basket.
            const body = {tariff_id, modemCount: quantity, ...couponBody(coupon),
                ...(metadata !== undefined ? {metadata: metadataText(metadata)} : {}),
                ...(want_p0f !== undefined ? {wantP0f: want_p0f} : {})};
            const path = funding_source === "btc" ? "/payment/buy-modems-with-crypto-balance" : "/payment/buy-with-account-credit";
            const receipt = await api.payment(path, body, idempotency_key);
            return {funding_source, ...receipt, charge: chargeReport(receipt, expected_total_usd), delivery: deliveryReport(receipt, quantity)};
        },
    });
    registerTool(server, "coronium_renew_modems_with_balance", {
        description: "SPENDS MONEY. Renew owned proxies for the given days from account credit or BTC. Get a renewal quote, show the total and get an explicit yes, then pass that total as expected_total_usd: the tool re-quotes and refuses if the total is now higher. Sends modems:[{modem_id,days}] and never a purchase tariff. Preserve the idempotency key and receipt; reconcile after unclear results.",
        input: {...renewalFields, funding_source: fundingSource, expected_total_usd: expectedTotalField, ...paymentFields},
        access: "write", money: "spends",
        routes: ["POST /payment/renewal-quote", "POST /payment/renew-with-account-credit", "POST /payment/renew-modems-with-crypto-balance"],
        run: async ({modems, coupon, funding_source, expected_total_usd, idempotency_key}) => {
            const quote = await renewalQuote(modems, coupon);
            assertWithinApproval(quote.total_usd, expected_total_usd);
            const path = funding_source === "btc" ? "/payment/renew-modems-with-crypto-balance" : "/payment/renew-with-account-credit";
            const receipt = await api.payment(path, {modems, ...couponBody(coupon)}, idempotency_key);
            return {funding_source, quote_before_submission: quote, ...receipt, charge: chargeReport(receipt, expected_total_usd), next_step: RECONCILE_STEP};
        },
    });
}

export function registerShopTools(server: McpServer): void {
    registerCatalogTools(server);
    registerSpendingTools(server);
}
