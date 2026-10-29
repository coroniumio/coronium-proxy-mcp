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
const PRICE_CHANGED_HINT = "Nothing was charged. The server's total is above the approved amount; details.quote holds the server's current figure. Get a new quote, show the user the new total and ask again. Only after a new yes, send it as expected_total_usd with a new idempotency_key.";

const couponField = z.string().min(1).max(128).optional();
const requireField = z.array(z.enum(["p0f"])).max(1).optional()
    .describe("Features every bought unit must have. [\"p0f\"] buys only units with TCP fingerprint (p0f) control; refused before any charge when the plan has too few of them.");
const wantP0fField = z.boolean().optional().describe("Deprecated alias: want_p0f:true is the same as require:[\"p0f\"]. Use require.");
const fundingSource = z.enum(["account_credit", "btc"]).describe("Required. account_credit spends USD account credit; btc spends the native BTC balance at the live rate.");
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

// The live total must equal the approved one. A lower price is refused too:
// it usually means a different plan, quantity or coupon than the user saw.
export function assertMatchesApproval(currentUsd: number, approvedUsd: number): void {
    if (Math.abs(currentUsd - approvedUsd) <= PRICE_TOLERANCE_USD) return;
    throw new CoroniumError({code: "price_changed",
        message: `The current total is $${currentUsd.toFixed(2)}, not the $${approvedUsd.toFixed(2)} the user approved. Nothing was charged. Show the new total and ask again.`,
        suggested_action: "requote_and_confirm", details: {current_total_usd: currentUsd, approved_total_usd: approvedUsd}});
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

function paymentIdOf(body: unknown): string | null {
    const value = (body as ApiObject | undefined)?.paymentId ?? (body as ApiObject | undefined)?.payment_id;
    return typeof value === "string" && value ? value : null;
}

function pollStep(paymentId: string): string {
    return `Poll coronium_get_payment_status with payment_id ${paymentId} until it reports the proxies or a failure, and check coronium_get_proxies. Activation usually takes a few minutes. Never buy again for this order.`;
}

// What the agent does after a money call: a payment ID means poll it; a queued
// (202) payment is not delivered yet, whatever the body says.
function paymentFollowUp(receipt: ApiObject): Record<string, unknown> {
    const paymentId = paymentIdOf(receipt?.response);
    const pending = receipt?.request?.http_status === 202;
    return {payment_id: paymentId, pending, next_step: paymentId ? pollStep(paymentId) : RECONCILE_STEP};
}

// The server's own refusals and unclear outcomes get the same guidance as the
// client-side checks: price_changed means re-approve, an unconfirmed delivery
// carries the payment ID to poll.
async function submitPayment(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<ApiObject> {
    try {
        return await api.payment(path, body, idempotencyKey);
    } catch (error) {
        if (!(error instanceof CoroniumError)) throw error;
        const details = error.details;
        if (details.code === "price_changed") throw new CoroniumError({...details, recovery_hint: PRICE_CHANGED_HINT});
        const paymentId = paymentIdOf(details.details);
        if (paymentId) throw new CoroniumError({...details, payment_id: paymentId, recovery_hint: `The outcome is not confirmed yet. ${pollStep(paymentId)}`});
        throw error;
    }
}

function cleanName(name: unknown): unknown {
    return typeof name === "string" ? name.trim() : name ?? null;
}

function p0fCount(tariff: ApiObject): number {
    const count = Number(tariff?.features?.p0f?.count);
    return Number.isFinite(count) ? count : 0;
}

// The tariff list counts p0f units with the same filter the server buys with,
// so a plan with fewer than quantity of them cannot fill a p0f order.
function assertP0fStock(tariff: ApiObject, quantity: number): void {
    const available = p0fCount(tariff);
    if (available >= quantity) return;
    throw new CoroniumError({code: "p0f_unavailable", message: `This plan has ${available} unit(s) with p0f control now; ${quantity} requested. Nothing was charged.`,
        suggested_action: "list_tariffs", recovery_hint: "Call coronium_list_tariffs and pick a plan whose features.p0f.count covers the quantity, or buy without require:[\"p0f\"] if the user agrees.",
        details: {p0f_available: available, requested: quantity}});
}

function tariffSummary(tariff: ApiObject): Record<string, unknown> {
    return {tariff_id: String(tariff._id), name: cleanName(tariff.name), country_code: tariff.country_code ?? null,
        carrier: tariff.carrier_name ?? null, period: tariff.period ?? null,
        price_usd: tariff.price ?? null, stock: tariff.stock ?? null, p0f_available: p0fCount(tariff)};
}

// Up to five plans that can fill this quantity now, same country first, cheapest first.
function inStockAlternatives(tariffs: ApiObject[], quantity: number, excludeId: string, countryCode?: string): Record<string, unknown>[] {
    const fits = tariffs.filter(row => String(row._id) !== excludeId && typeof row.stock === "number" && row.stock >= quantity);
    const sameCountry = countryCode ? fits.filter(row => row.country_code === countryCode) : [];
    const pool = sameCountry.length ? sameCountry : fits;
    return pool.sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 5).map(tariffSummary);
}

function stockHint(label: string, alternatives: Record<string, unknown>[]): string {
    const listed = alternatives.map(row => `${row.name ?? row.tariff_id} (${row.country_code}, $${row.price_usd}, ${row.stock} in stock)`).join("; ");
    const inStock = listed ? ` In stock now: ${listed}.` : "";
    return `${label}${inStock} Call coronium_list_free_modems for live counts.`;
}

async function currentTariff(tariffId: string, quantity: number, countryCode?: string): Promise<ApiObject> {
    const tariffs = arrayResponse(await api.publicGet("/tariffs/available"), "Available tariffs");
    const tariff = tariffs.find(row => String(row._id) === tariffId);
    if (!tariff || (countryCode && tariff.country_code !== countryCode)) {
        const alternatives = inStockAlternatives(tariffs, quantity, tariffId, countryCode);
        throw new CoroniumError({code: "tariff_unavailable", message: "The tariff is unavailable or does not match the requested country.", suggested_action: "list_tariffs",
            recovery_hint: stockHint("That plan is not on sale right now.", alternatives), details: {in_stock_now: alternatives}});
    }
    if (typeof tariff.stock !== "number" || tariff.stock < quantity) {
        const alternatives = inStockAlternatives(tariffs, quantity, tariffId, tariff.country_code);
        const what = [tariff.country_code, tariff.name].filter(Boolean).join(" ");
        throw new CoroniumError({code: "insufficient_stock", message: "The current stock snapshot cannot satisfy this quantity.", suggested_action: "list_tariffs",
            recovery_hint: stockHint(`Not enough stock for ${quantity} of ${what || "this plan"} (${tariff.stock ?? 0} available).`, alternatives),
            details: {available: tariff.stock ?? 0, requested: quantity, in_stock_now: alternatives}});
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
            let tariffs: ApiObject[] = arrayResponse(response, "Available tariffs").map((tariff): ApiObject => ({...tariff, name: cleanName(tariff.name)}));
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
    registerTool(server, "coronium_quote_purchase", {
        description: "Get the exact USD total for buying a dedicated proxy plan: live price times quantity, with an optional coupon applied, after checking current stock. Spends nothing and changes nothing. Show total_usd to the user and get a clear yes before any purchase; that same number is the expected_total_usd for coronium_buy_modems_with_balance. A quote is not a price lock or a stock reservation.",
        input: {tariff_id: idSchema, quantity: z.number().int().min(1).max(100), coupon: couponField,
            country_code: countrySchema.optional().describe("Optional guard: refuse if this does not match the plan's country."), require: requireField},
        routes: ["GET /tariffs/available", "POST /coupons/check"],
        run: async ({tariff_id, quantity, coupon, country_code, require}) => {
            const tariff = await currentTariff(tariff_id, quantity, country_code);
            const p0f = Boolean(require?.includes("p0f"));
            if (p0f) assertP0fStock(tariff, quantity);
            const listTotal = roundCents(Number(tariff.price) * quantity);
            const total = await currentBuyTotal(tariff, quantity, coupon);
            return {plan: tariffSummary(tariff), quantity, unit_price_usd: tariff.price, list_total_usd: listTotal,
                coupon: coupon ?? null, require: p0f ? ["p0f"] : [], total_usd: total, expected_total_usd: total,
                next_step: `Show total_usd to the user. Only after a clear yes, buy with expected_total_usd set to this number${p0f ? ", the same require:[\"p0f\"]" : ""}, confirm:true and a new idempotency_key.`};
        },
    });
    registerTool(server, "coronium_get_renewal_quote", {
        description: "Get the backend's USD renewal quote for owned proxies (1-90 days each). Refuses partial quotes. Spends nothing and changes nothing. Quotes are not price locks. Payment happens in the dashboard unless spending is enabled in this MCP.",
        input: renewalFields, routes: ["POST /payment/renewal-quote"],
        run: async ({modems, coupon}) => ({quote: await renewalQuote(modems, coupon)}),
    });
    registerTool(server, "coronium_get_payment_status", {
        description: "Read a payment's current status by its ID. Use it after a 202 or an unclear purchase result instead of buying again. Keep pending and failed states as they are; do not infer delivery from HTTP success alone.",
        input: {payment_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)}, routes: ["GET /payments/:id/status"],
        run: async ({payment_id}) => ({response: await api.get(`/payments/${encodeURIComponent(payment_id)}/status`)}),
    });
}

function registerSpendingTools(server: McpServer): void {
    registerTool(server, "coronium_buy_modems_with_balance", {
        description: "SPENDS MONEY. Buy dedicated proxies from account credit or BTC. First call coronium_quote_purchase and coronium_get_balance, show the user the plan, quantity, funding source and total, and get an explicit yes. Pass that total as expected_total_usd: the tool re-reads the live price and refuses if it differs, and sends it as max_total_usd so the server refuses (409 price_changed, nothing charged) a higher total too. Use one new idempotency_key per purchase; it goes out as the Idempotency-Key header. The receipt carries payment_id: on 202 (pending) or 503 payment_delivery_unconfirmed, poll coronium_get_payment_status with it and check coronium_get_proxies; never buy again. Activation usually takes a few minutes.",
        input: {tariff_id: idSchema, quantity: z.number().int().min(1).max(100), funding_source: fundingSource, expected_total_usd: expectedTotalField,
            country_code: countrySchema.optional().describe("Optional guard: refuse if this does not match the selected tariff's country."),
            metadata: z.union([z.string().max(8000), z.record(z.unknown())]).optional(), coupon: couponField, require: requireField, want_p0f: wantP0fField, ...paymentFields},
        access: "write", money: "spends",
        routes: ["GET /tariffs/available", "POST /coupons/check", "POST /payment/buy-with-account-credit", "POST /payment/buy-modems-with-crypto-balance"],
        run: async ({tariff_id, quantity, funding_source, expected_total_usd, country_code, metadata, coupon, require, want_p0f, idempotency_key}) => {
            const p0f = Boolean(require?.includes("p0f")) || want_p0f === true;
            const tariff = await currentTariff(tariff_id, quantity, country_code);
            if (p0f) assertP0fStock(tariff, quantity);
            assertMatchesApproval(await currentBuyTotal(tariff, quantity, coupon), expected_total_usd);
            // A buy sends only the purchase fields, never a renewal basket.
            // max_total_usd lets the server refuse a total above the approval.
            const body = {tariff_id, modemCount: quantity, max_total_usd: expected_total_usd, ...couponBody(coupon),
                ...(metadata !== undefined ? {metadata: metadataText(metadata)} : {}),
                ...(p0f ? {require: ["p0f"]} : {})};
            const path = funding_source === "btc" ? "/payment/buy-modems-with-crypto-balance" : "/payment/buy-with-account-credit";
            const receipt = await submitPayment(path, body, idempotency_key);
            const followUp = paymentFollowUp(receipt);
            return {funding_source, ...receipt, ...followUp, charge: chargeReport(receipt, expected_total_usd),
                delivery: {...deliveryReport(receipt, quantity), next_step: followUp.next_step}};
        },
    });
    registerTool(server, "coronium_renew_modems_with_balance", {
        description: "SPENDS MONEY. Renew owned proxies for the given days from account credit or BTC. Get a renewal quote, show the total and get an explicit yes, then pass that total as expected_total_usd: the tool re-quotes and refuses if the total differs, and sends it as max_total_usd so the server refuses a higher total too. Sends modems:[{modem_id,days}] and never a purchase tariff. Preserve the idempotency key and receipt; on 202 or an unclear result poll coronium_get_payment_status with payment_id, never renew again.",
        input: {...renewalFields, funding_source: fundingSource, expected_total_usd: expectedTotalField, ...paymentFields},
        access: "write", money: "spends",
        routes: ["POST /payment/renewal-quote", "POST /payment/renew-with-account-credit", "POST /payment/renew-modems-with-crypto-balance"],
        run: async ({modems, coupon, funding_source, expected_total_usd, idempotency_key}) => {
            const quote = await renewalQuote(modems, coupon);
            assertMatchesApproval(quote.total_usd, expected_total_usd);
            const path = funding_source === "btc" ? "/payment/renew-modems-with-crypto-balance" : "/payment/renew-with-account-credit";
            const receipt = await submitPayment(path, {modems, max_total_usd: expected_total_usd, ...couponBody(coupon)}, idempotency_key);
            return {funding_source, quote_before_submission: quote, ...receipt, ...paymentFollowUp(receipt), charge: chargeReport(receipt, expected_total_usd)};
        },
    });
}

export function registerShopTools(server: McpServer): void {
    registerCatalogTools(server);
    registerSpendingTools(server);
}
