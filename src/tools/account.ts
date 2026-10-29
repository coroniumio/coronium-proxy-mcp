import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api, type ApiObject} from "../api-client.js";
import {arrayResponse, finiteNumber} from "../formatters.js";
import {confirmation, registerTool} from "../tool.js";

const balanceOutput = z.object({
    account_credit: z.object({amount: z.number(), currency: z.literal("USD")}),
    btc: z.object({amount: z.number(), currency: z.literal("BTC")}),
    usdt: z.object({amount: z.number(), currency: z.literal("USDT")}),
});

const httpsUrl = z.string().url().refine(value => new URL(value).protocol === "https:", "HTTPS is required.");

function balances(account: ApiObject): z.infer<typeof balanceOutput> {
    return {
        account_credit: {amount: finiteNumber(account?.accountCredit, "USD account credit"), currency: "USD"},
        btc: {amount: finiteNumber(account?.btc?.balance, "BTC balance"), currency: "BTC"},
        usdt: {amount: finiteNumber(account?.usdt?.balance, "USDT balance"), currency: "USDT"},
    };
}

function registerWebhookTools(server: McpServer): void {
    registerTool(server, "coronium_get_webhook", {
        description: "Read the account webhook: URL, whether it is enabled, whether automatic replacement of dead proxies is on, signing secret status (preview only) and the event list.",
        input: {}, routes: ["GET /account/webhook"],
        run: async () => ({response: await api.get("/account/webhook")}),
    });
    registerTool(server, "coronium_set_webhook", {
        description: "Set the account webhook URL (public HTTPS), or pass null to turn it off. WARNING: setting a URL also turns on automatic replacement of dead proxies. When a proxy is detected dead, Coronium swaps it for a new one in the same location without asking per replacement, so its host and credentials change and the manual replacement quota does not apply. Deliveries are signed with the X-Coronium-Signature HMAC header. Explain this to the user before confirming.",
        input: {webhook_url: httpsUrl.nullable(), confirm: confirmation},
        access: "write", destructive: true, idempotent: true, routes: ["PUT /account/webhook"],
        run: async ({webhook_url}) => ({response: await api.put("/account/webhook", {webhook_url})}),
    });
    registerTool(server, "coronium_delete_webhook", {
        description: "Remove the account webhook URL. This stops event delivery and turns off automatic replacement of dead proxies; dead-proxy notices go back to email. The signing secret is kept.",
        input: {confirm: confirmation}, access: "write", destructive: true, idempotent: true, routes: ["DELETE /account/webhook"],
        run: async () => ({response: await api.del("/account/webhook")}),
    });
    registerTool(server, "coronium_rotate_webhook_secret", {
        description: "Replace the webhook signing secret. The old secret stops verifying immediately, including retries of queued events. The new secret is returned once in this result and cannot be read again; store it before continuing.",
        input: {confirm: confirmation}, access: "write", destructive: true, routes: ["POST /account/webhook/secret/rotate"],
        run: async () => ({response: await api.post("/account/webhook/secret/rotate")}),
    });
    registerTool(server, "coronium_test_webhook", {
        description: "Send a real signed test event to the registered webhook. Returns ok:true when it was delivered and ok:false with the delivery error otherwise. Sends an outbound HTTP request; requires authorization.",
        input: {confirm: confirmation}, access: "write", routes: ["POST /account/webhook/test"],
        run: async () => {
            const response = await api.post("/account/webhook/test", {}, {diagnostic: true});
            return {ok: response?.delivered === true, response};
        },
    });
}

export function registerAccountTools(server: McpServer): void {
    registerTool(server, "coronium_get_account", {
        description: "Read the authenticated account profile exactly as supplied by the backend: identity, native balances and proxy count.",
        input: {}, routes: ["GET /account"],
        run: async () => ({account: await api.get("/account")}),
    });
    registerTool(server, "coronium_get_balance", {
        description: "Read USD account credit, BTC and USDT as separate native balances. Does not create wallets or guess exchange rates. A missing balance is an error, never zero.",
        input: {}, output: balanceOutput, routes: ["GET /account"],
        run: async () => balances(await api.get("/account")),
    });
    registerTool(server, "coronium_get_crypto_balance", {
        description: "Get crypto deposit addresses and native balances. Only the BTC balance can pay for proxies through this MCP (funding_source btc), once the deposit confirms. This backend GET can create missing wallets, so it is treated as a write. Use get_balance for a pure balance read.",
        input: {}, access: "write", routes: ["GET /account/crypto-balance"],
        run: async () => ({wallets: arrayResponse(await api.get("/account/crypto-balance", undefined, {mutates: true}), "Wallets")}),
    });
    registerTool(server, "coronium_get_credit_cards", {
        description: "Read saved-card summaries supplied by the backend. Card checkout and any required authentication are handled in the dashboard.",
        input: {}, routes: ["GET /account/card-list"],
        run: async () => ({response: await api.get("/account/card-list")}),
    });
    registerTool(server, "coronium_get_low_balance_threshold", {
        description: "Read configured USD low-balance email alert thresholds.",
        input: {}, routes: ["GET /account/low-balance-threshold"],
        run: async () => ({response: await api.get("/account/low-balance-threshold")}),
    });
    registerTool(server, "coronium_set_low_balance_threshold", {
        description: "Set low-balance email alerts to a subset of 100, 300 and 500 USD. An empty array disables these alerts.",
        input: {thresholds: z.array(z.union([z.literal(100), z.literal(300), z.literal(500)])).max(3)},
        access: "write", idempotent: true, routes: ["PUT /account/low-balance-threshold"],
        run: async ({thresholds}) => ({response: await api.put("/account/low-balance-threshold", {thresholds: [...new Set(thresholds)]})}),
    });
    registerTool(server, "coronium_get_payments", {
        description: "Read the account payment ledger, preserving transaction IDs, currencies and reconciliation fields. Historical ledger values do not replace the current balance. This backend route does not support pagination.",
        input: {}, routes: ["GET /account/payments"],
        run: async () => ({response: await api.get("/account/payments")}),
    });
    registerTool(server, "coronium_get_subscriptions", {
        description: "Read current modem subscriptions, renewal methods and the backend's renewal status snapshot. Unknown card-provider state must remain unknown. Auto-renew is managed in the dashboard.",
        input: {}, routes: ["GET /account/subscriptions"],
        run: async () => ({response: await api.get("/account/subscriptions")}),
    });
    registerWebhookTools(server);
}
