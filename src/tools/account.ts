import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {arrayResponse, finiteNumber} from "../formatters.js";
import {confirmation, registerTool} from "../tool.js";

export function registerAccountTools(server: McpServer): void {
    registerTool(server, "coronium_get_account", {
        description: "Read the authenticated account profile exactly as supplied by the backend: identity, native balances and proxy count.",
        input: {}, run: async () => ({account: await api.get("/account")}),
    });
    registerTool(server, "coronium_get_balance", {
        description: "Read USD account credit, BTC and USDT as separate native balances from /account. Does not create wallets or guess exchange rates. A missing balance is an error, never zero. Modem purchases support account_credit or btc; pool purchases use account_credit.",
        input: {},
        output: z.object({account_credit: z.object({amount: z.number(), currency: z.literal("USD")}), btc: z.object({amount: z.number(), currency: z.literal("BTC")}), usdt: z.object({amount: z.number(), currency: z.literal("USDT")})}),
        run: async () => {
            const account = await api.get("/account");
            return {account_credit: {amount: finiteNumber(account?.accountCredit, "USD account credit"), currency: "USD"},
                btc: {amount: finiteNumber(account?.btc?.balance, "BTC balance"), currency: "BTC"},
                usdt: {amount: finiteNumber(account?.usdt?.balance, "USDT balance"), currency: "USDT"}};
        },
    });
    registerTool(server, "coronium_get_crypto_balance", {
        description: "Get crypto deposit addresses and native balances. This backend GET can create missing wallets, so it is unavailable in read-only mode. Use get_balance for a pure balance read. No automatic currency-conversion claim is made.",
        input: {}, access: "write",
        run: async () => ({wallets: arrayResponse(await api.get("/account/crypto-balance", undefined, {mutates: true}), "Wallets")}),
    });
    registerTool(server, "coronium_get_credit_cards", {
        description: "Read saved-card summaries supplied by the backend. Card checkout and any required authentication are handled in the dashboard.",
        input: {}, run: async () => ({response: await api.get("/account/card-list")}),
    });
    registerTool(server, "coronium_get_low_balance_threshold", {
        description: "Read configured USD low-balance email alert thresholds.", input: {},
        run: async () => ({response: await api.get("/account/low-balance-threshold")}),
    });
    registerTool(server, "coronium_set_low_balance_threshold", {
        description: "Set low-balance email alerts to a subset of 100, 300 and 500 USD. An empty array disables these alerts.",
        input: {thresholds: z.array(z.union([z.literal(100), z.literal(300), z.literal(500)])).max(3)}, access: "write", idempotent: true,
        run: async ({thresholds}) => ({response: await api.put("/account/low-balance-threshold", {thresholds: [...new Set(thresholds)]})}),
    });
    registerTool(server, "coronium_get_payments", {
        description: "Read the account payment ledger, preserving transaction IDs, currencies and reconciliation fields. Historical ledger values do not replace the current balance. This backend route does not support pagination.",
        input: {}, run: async () => ({response: await api.get("/account/payments")}),
    });
    registerTool(server, "coronium_get_subscriptions", {
        description: "Read current modem subscriptions, renewal methods and the backend's renewal status snapshot. Unknown Stripe state must remain unknown. Use the dashboard to disable auto-renew; cancel_modem releases a proxy immediately.",
        input: {}, run: async () => ({response: await api.get("/account/subscriptions")}),
    });
    registerTool(server, "coronium_get_webhook", {
        description: "Read the registered webhook URL and available event information.", input: {},
        run: async () => ({response: await api.get("/account/webhook")}),
    });
    registerTool(server, "coronium_set_webhook", {
        description: "Replace the account's webhook destination, or explicitly pass null to disable it. The backend validates public HTTPS targets. Requires authorization to change event delivery.",
        input: {webhook_url: z.string().url().refine(value => new URL(value).protocol === "https:", "HTTPS is required.").nullable(), confirm: confirmation},
        access: "write", destructive: true, idempotent: true,
        run: async ({webhook_url}) => ({response: await api.put("/account/webhook", {webhook_url})}),
    });
    registerTool(server, "coronium_test_webhook", {
        description: "Send a real test event to the registered webhook and return the backend's delivery result. This sends an outbound HTTP request and records delivery; requires authorization.",
        input: {confirm: confirmation}, access: "write",
        run: async () => ({response: await api.post("/account/webhook/test")}),
    });
}
