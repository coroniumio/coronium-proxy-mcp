// Account tools: profile, balance (multi-coin USD-denominated), saved
// cards, deposit addresses, low-balance threshold (the endpoint shipped
// 2026-04-30 — agents can now configure the email-alert tier from MCP).

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {tokenStore} from "../token-store.js";
import {getCoinPrices} from "../prices.js";
import {ok, err} from "../formatters.js";

export function registerAccountTools(server: McpServer) {
    server.tool(
        "coronium_get_account",
        "Get account profile (email, role, contact, business data) and overall balance summary.",
        {},
        async () => {
            try {
                const data = await api.v1Get("/account");
                const lines = [
                    `email:          ${data.login || data.email}`,
                    `role:           ${data.roleId ?? data.role ?? "?"}`,
                    `first_name:     ${data.first_name || "—"}`,
                    `last_name:      ${data.last_name || "—"}`,
                    `phone:          ${data.phone || "—"}`,
                    `company:        ${data.company || "—"}`,
                    `account_credit: $${(Number(data.balance?.usd || 0)).toFixed(2)}`,
                    `2fa_enabled:    ${!!data.totp_2fa}`,
                ];
                return ok(lines.join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_balance",
        "Get full multi-currency balance: account credit (USD) plus crypto wallet balances (BTC/ETH/USDT/USDC/TRX) with live USD valuation. Crypto prices cached for 60s.",
        {},
        async () => {
            try {
                const [balanceArr, accountInfo, prices] = await Promise.all([
                    api.v1Get<any[]>("/account-balance").catch(() => null),
                    api.v1Get<any>("/account").catch(() => null),
                    getCoinPrices(),
                ]);

                const lines: string[] = [];
                let totalUsd = 0;

                // account_credit comes from /account.balance.usd OR balance array entry
                const accountCredit = Number(accountInfo?.balance?.usd || 0);
                if (accountCredit > 0 || (balanceArr && balanceArr.find(b => b.coin === "account_credit"))) {
                    lines.push(`account_credit:  $${accountCredit.toFixed(2)} USD`);
                    totalUsd += accountCredit;
                }

                if (Array.isArray(balanceArr)) {
                    for (const b of balanceArr) {
                        if (b.coin === "account_credit") continue;
                        const sym = (b.coin || "?").toUpperCase();
                        const amount = Number(b.balance || 0);
                        const price = prices[String(b.coin).toLowerCase()] || 0;
                        const usd = amount * price;
                        totalUsd += usd;
                        lines.push(`${sym.padEnd(15)}  ${amount.toFixed(8).padStart(14)} (≈ $${usd.toFixed(2)} @ $${price})`);
                    }
                }

                lines.push("");
                lines.push(`TOTAL (USD):     $${totalUsd.toFixed(2)}`);
                if (lines.length === 2) return ok("No balance entries found.");
                return ok(lines.join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_crypto_balance",
        "Legacy alias retained for backward compat — returns the same crypto-only view the MCP has always exposed (deposit addresses + balances). Prefer coronium_get_balance for the unified view.",
        {},
        async () => {
            try {
                const data = await api.v1Get<any[]>("/account/crypto-balance");
                if (!Array.isArray(data) || data.length === 0) return ok("No deposit addresses on file.");
                tokenStore.saveCryptoAddresses(data.map(d => ({coin: d.coin, address: d.address, balance: d.balance})));
                const lines = data.map(d => {
                    const amt = Number(d.balance || 0);
                    return `${(d.coin || "?").toUpperCase().padEnd(8)}  balance=${amt.toFixed(8)}  address=${d.address}`;
                });
                return ok(lines.join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_credit_cards",
        "List saved credit cards on file (Stripe). Returns last-4 digits + brand only.",
        {},
        async () => {
            try {
                const data = await api.v1Get<any[]>("/account/card-list");
                if (!Array.isArray(data) || data.length === 0) return ok("No saved cards.");
                return ok(data.map(c => `  ${c.brand || "?"} **** ${c.last4 || "????"}  exp ${c.exp_month || "??"}/${c.exp_year || "????"}  id=${c._id || c.id}`).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_low_balance_threshold",
        "Get the configured low-balance email alert tiers (USD amounts). When account_credit drops below a tier, an alert email is sent. Endpoint shipped 2026-04-30.",
        {},
        async () => {
            try {
                const data = await api.v1Get("/account/low-balance-threshold");
                const tiers = data.thresholds || data.tiers || (data.threshold != null ? [data.threshold] : []);
                if (!tiers.length) return ok("No low-balance tiers configured.");
                return ok("Configured tiers (USD):\n" + tiers.map((t: number) => `  $${t}`).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_set_low_balance_threshold",
        "Set low-balance email alert tiers (one or more USD amounts). Email is sent when account_credit dips below each tier. Endpoint shipped 2026-04-30.",
        {
            thresholds: z.array(z.number().nonnegative()).min(1).describe("USD amounts, e.g. [100, 300]. Pass an empty array via `clear: true` to disable all tiers."),
        },
        async ({thresholds}) => {
            try {
                await api.v1Put("/account/low-balance-threshold", {thresholds});
                return ok(`✓ Saved ${thresholds.length} threshold(s): ${thresholds.map(t => "$" + t).join(", ")}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );
}
