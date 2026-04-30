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
                const data = await api.get("/account");
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
        "Get the customer's spendable balance. Shows account_credit (USD wallet — what's actually used to pay for proxies) plus any held crypto balances valued in USD. Crypto prices cached 60s; not shown per row.",
        {},
        async () => {
            try {
                const [account, cryptoArr, prices] = await Promise.all([
                    api.get<any>("/account").catch(() => null),
                    api.get<any[]>("/account/crypto-balance").catch(() => null),
                    getCoinPrices(),
                ]);

                // account_credit is the USD ledger the customer spends from. The
                // /account/crypto-balance endpoint sometimes echoes it back as a
                // pseudo-coin entry — filter that out so we don't double-count or
                // try to price it as a coin.
                const accountCredit = Number(account?.balance ?? 0);

                const lines: string[] = [];
                lines.push(`account_credit  $${accountCredit.toFixed(2)} USD`);
                let cryptoUsd = 0;

                if (Array.isArray(cryptoArr)) {
                    const coinRows = cryptoArr.filter(b => String(b.coin || "").toLowerCase() !== "account_credit");
                    if (coinRows.length) {
                        lines.push("");
                        lines.push("crypto deposits:");
                        for (const b of coinRows) {
                            const sym = String(b.coin || "?").toUpperCase();
                            const amount = Number(b.balance || 0);
                            const price = prices[String(b.coin).toLowerCase()] || 0;
                            const usd = amount * price;
                            cryptoUsd += usd;
                            lines.push(`  ${sym.padEnd(6)} ${amount.toFixed(8).padStart(14)}   ≈ $${usd.toFixed(2)} USD`);
                        }
                    }
                }

                const total = accountCredit + cryptoUsd;
                lines.push("");
                lines.push(`spendable:      $${accountCredit.toFixed(2)} USD (account_credit only)`);
                if (cryptoUsd > 0.01) lines.push(`crypto holdings: $${cryptoUsd.toFixed(2)} USD (deposit to convert to account_credit)`);
                lines.push(`total value:    $${total.toFixed(2)} USD`);
                return ok(lines.join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_crypto_balance",
        "List crypto deposit addresses + balances (BTC, USDT, etc). Use these addresses to top up — incoming transfers convert to account_credit at deposit time. Account_credit itself is excluded; use coronium_get_balance for that.",
        {},
        async () => {
            try {
                const data = await api.get<any[]>("/account/crypto-balance");
                if (!Array.isArray(data) || data.length === 0) return ok("No deposit addresses on file.");
                // Drop the pseudo-coin "account_credit" — it's the USD ledger,
                // not a depositable crypto, and the API echoes it here for
                // historical reasons.
                const coins = data.filter(d => String(d.coin || "").toLowerCase() !== "account_credit");
                if (coins.length === 0) return ok("No crypto deposit addresses (account_credit only).");
                tokenStore.saveCryptoAddresses(coins.map(d => ({coin: d.coin, address: d.address, balance: d.balance})));
                const lines = coins.map(d => {
                    const amt = Number(d.balance || 0);
                    return `${String(d.coin || "?").toUpperCase().padEnd(6)}  balance ${amt.toFixed(8)}   deposit to: ${d.address}`;
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
                const data = await api.get<any[]>("/account/card-list");
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
                const data = await api.get("/account/low-balance-threshold");
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
        "Set low-balance email alert tiers. The backend currently allows exactly these tier values: 100, 300, 500 (USD). Pass any subset — e.g. [100], [100,300], [100,300,500]. Email is sent when account_credit dips below each tier independently.",
        {
            thresholds: z.array(z.union([z.literal(100), z.literal(300), z.literal(500)]))
                .min(0).max(3)
                .describe("Subset of [100, 300, 500]. Empty array clears all tiers (turns off alerts)."),
        },
        async ({thresholds}) => {
            try {
                await api.put("/account/low-balance-threshold", {thresholds});
                if (thresholds.length === 0) return ok("✓ All low-balance tiers cleared (alerts disabled).");
                return ok(`✓ Saved ${thresholds.length} threshold(s): ${thresholds.map(t => "$" + t).join(", ")}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );
}
