# Coronium Mobile Proxy MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Coronium.io](https://img.shields.io/badge/Coronium.io-Mobile%20Proxies-orange)](https://coronium.io)
[![Dashboard](https://img.shields.io/badge/Dashboard-Manage%20Proxies-green)](https://dashboard.coronium.io)
[![Version](https://img.shields.io/badge/Version-1.3.0-success)](https://github.com/coroniumio/coronium-proxy-mcp/releases)
[![npm](https://img.shields.io/npm/v/coronium-proxy-mcp.svg)](https://www.npmjs.com/package/coronium-proxy-mcp)

MCP (Model Context Protocol) server for [Coronium.io](https://coronium.io) mobile (4G/5G) proxy management. Drive the full proxy lifecycle — list, rotate, replace, test, configure auto-rotation, buy, renew, manage subscriptions, open tickets — directly from Claude, Cursor, Cline, VS Code, Zed, Continue, and any other MCP-compatible host. Manage your account at [dashboard.coronium.io](https://dashboard.coronium.io).

> **Tool count is whatever `tools/list` returns in your installed version — trust that over any number in this README.** This repo (`main`, **v1.3.0**) exposes **48 tools** across 6 groups — auth (3), account (9), pool (8), proxies (16), shop (7), tickets (5) — including the pay-per-GB **Pool Gateway** tier. The published npm `latest` is still **v1.2.4** (the 34-tool core lifecycle, no pool) until 1.3.0 is published; install from source for the full surface. Also: live coin pricing, transparent token refresh, modular codebase. See [CHANGELOG.md](CHANGELOG.md).

> **Mental model + operating principles** live in the canonical agent skill: <https://dashboard.coronium.io/SKILL.md>. In one breath: a Coronium proxy is a *real SIM in a real device* on a carrier CGNAT pool — finite, stateful, physical. Drive it with [code-simplifier](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md) discipline — **smallest sufficient action** (don't rotate when sticky works; `restart` before `replace` before buy-new), **read reality before acting** (`tools/list`, `list_tariffs`, health — don't assume), a **`200` is "accepted," not "done"** (verify the egress IP changed), and **no looping/speculative mutations** (irreversible actions need confirmation). The recipes are defaults, not laws — **compose your own**; only the safety/cost rules and the network's physics (rate limits, finite stock, ~290s carrier sticky window) are fixed.

## Which Coronium MCP do I want?

Two MCP servers exist and both hit the same backend (`https://api.coronium.io/api/v3`). Pick by your starting state:

| You are… | Use | Why |
|---|---|---|
| **A Coronium customer** with an existing dashboard.coronium.io email/password | **`coronium-proxy-mcp`** (this repo) | The full lifecycle surface (run `tools/list` for the exact set — ~34 on npm, ~48 on `main`): tickets, low-balance alerts, OS fingerprinting, modem metadata, account settings, pool, plus the 7 core verbs |
| **An AI agent** or **a new user** who wants one-command signup, no email | [`coronium-cli` + `coronium-mcp`](https://github.com/bolivian-peru/coronium-ai) | Voucher-gated, wallet-bound (SIWE) signup. 7 minimal verbs. `npx -y coronium-cli init --voucher cor_v1_…` and you have a working JWT |

The two MCPs are intentional siblings, not duplicates — different auth model, different tool depth. Once signed in, both produce JWTs against the same API, so you can switch later if needs change.

## Decision guide for AI agents

When this MCP is loaded inside Claude / Cursor / Windsurf / etc., the agent can reach for any tool `tools/list` exposes. The right choice usually isn't "what's the closest tool name match" — these tools have real semantic differences. Read this once before driving the surface.

### Rotate vs Replace — they are NOT interchangeable

| Symptom | Use | Cost | Why |
|---|---|---|---|
| IP got banned by the target site, modem otherwise healthy | `coronium_restart_modem` | free | Same modem, fresh IP from the carrier. ~20-second operation. |
| Modem hasn't responded in N minutes, multiple `test_modem` failures | `coronium_replace_modem` | free (subscription transfers) | Swap to a different physical modem in the same country. Use this when rotation alone keeps yielding the same dead IP. |
| Need a different country/carrier | Buy a new one + release the old | $$ | Rotate/replace stay within country. |

**Anti-pattern**: don't loop `coronium_restart_modem` more than 2 times — if rotation keeps returning the same IP, the carrier isn't releasing it. Switch to `coronium_replace_modem`. The backend's stuck-rotation janitor (deployed 2026-04-30) auto-clears stale "rotating" states within 5 min, so a hung rotation isn't a permanent block.

### Stock-out handling

`coronium_buy_modems_with_balance` returns 4xx if the requested country has no inventory. **Don't loop the same call.** Instead:

1. `coronium_list_free_modems` — confirms what stock exists right now
2. If empty for the target country, fall back to a neighbouring market (US ↔ CA, DE ↔ NL ↔ AT, UK ↔ IE) or alert the human
3. `coronium_list_tariffs` — surfaces price across countries so you can compare

### Reading balance correctly

`coronium_get_balance` returns three numbers:
- `account_credit` — USD wallet, **what's actually spent** by buy/renew tools
- `crypto deposits:` — held but unspent crypto (BTC/USDT/etc.). Will convert to account_credit when deposit is detected; not directly spendable.
- `total value` — informational, sum across both

Always compare a planned purchase against `account_credit`, not `total value`. A user with $0 account_credit and $50 in undeposited crypto **cannot buy** until the deposit is processed.

### Rotation interval — pick by use case

`coronium_set_rotation_interval` takes seconds. Common values:

| Use case | Interval | Notes |
|---|---|---|
| High-volume scraping | 60 s | Maxes carrier rotation cadence; some carriers throttle below 90s |
| Account farming | 300 s (5 min) | Reduces detection from rotation-frequency fingerprints |
| Long-lived persona | 1800 s (30 min) | Or 0 (disable auto-rotate, rotate manually only) |
| Sticky session | 0 | Manual control via `coronium_restart_modem` |

### When to open a ticket vs retry

Open a ticket via `coronium_create_ticket` when:
- A modem has been "replaced" twice in 24h and still doesn't work — likely server-level issue
- A payment shows `status: pending` for >10 min after `coronium_buy_modems_with_balance` returned a payment_id
- An ext_ip never updates despite repeated successful rotations (rare; janitor should catch this)

**Don't** open a ticket for:
- Stock-out (try a different country first)
- "My IP got banned" (rotate / replace handles this)
- "Speed is slow" (carrier-side; not actionable by support)

### Auto-login posture

If `CORONIUM_LOGIN` and `CORONIUM_PASSWORD` are set in the MCP env, **don't** call `coronium_login` proactively. The MCP auto-logs-in on the first 401 and caches the token at `~/.coronium/token.enc` (AES-256-CBC). Manual `coronium_login` is only needed for explicit account switching or token diagnostics.

### Country/carrier selection heuristics

- **Target site is geo-fenced**: pick the same country as the target audience. e.g. US TikTok → US carrier.
- **Captcha / fraud-detection sensitivity**: prefer 5G T-Mobile (US) or Three (UK) — carrier-grade NAT pools rotate aggressively, so individual IPs look "real residential mobile" rather than datacenter.
- **Cost-sensitive**: list tariffs by `coronium_list_tariffs --country PL` (Poland Play / Plus) — cheap, high-volume EU pool.
- **Asia-Pacific**: stock thin. Always `coronium_list_free_modems --country TH/AU/NZ` first.

### Tool-naming distinction (across MCPs)

If the agent has both this MCP and the wallet-bound `coronium-mcp` loaded, the tool prefixes tell it which auth path is active:

- `coronium_*` (this server) → email/password auth, full lifecycle, existing-customer mode
- `<verb>_<noun>` like `proxy_rotate`, `proxy_buy` ([coronium-mcp](https://github.com/bolivian-peru/coronium-ai)) → wallet/SIWE auth, agent-native mode

Don't mix-and-match in the same session unless you've confirmed the JWTs are the same identity.

## Prerequisites

- A [Coronium.io account](https://coronium.io) — sign up via the dashboard
- Node.js 18+ installed

## Quick Start

### 1. Install

```bash
git clone https://github.com/coroniumio/coronium-proxy-mcp.git
cd coronium-proxy-mcp
npm install
npm run build
```

### 2. Configure your AI tool

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "coronium": {
      "command": "node",
      "args": ["/absolute/path/to/coronium-proxy-mcp/dist/server.js"],
      "env": {
        "CORONIUM_LOGIN": "your-email@example.com",
        "CORONIUM_PASSWORD": "your-password"
      }
    }
  }
}
```

#### Cursor IDE / Cline / VS Code Copilot / Zed / Continue

Same shape — add to the host's MCP config (`.cursor/mcp.json`, Cline's MCP settings, etc).

### 3. Restart your tool

Talk to your AI: "list my Coronium proxies", "rotate the Polish one", "show my balance", "open a ticket about modem cor_US_xxx not working".

## What's new in 1.3.0

**Pool Gateway (pay-per-GB) — 8 new tools.** A new product alongside dedicated modems: the metered, pay-per-GB **Pool Gateway** (powered by Proxies.sx), bought from your Coronium account balance. `coronium_get_pool_stock`, `coronium_list_pool_keys`, `coronium_build_pool_proxy_url`, `coronium_buy_pool_with_balance`, `coronium_topup_pool_key`, `coronium_cancel_pool_key`, `coronium_list_pool_sessions`, `coronium_close_pool_session`. See [Pool Gateway](#pool-gateway-pay-per-gb) below. Tools return a clear error when the pool tier isn't enabled on your account (HTTP 503).

**6 more lifecycle tools** for v3 endpoints shipped since 1.2.4: `coronium_get_proxy_health` (per-modem liveness so agents stop retrying dead proxies), `coronium_get_payments` (full payment + invoice ledger for reconciliation), `coronium_get_p0f_options` (valid OS values for `set_modem_os`), `coronium_apply_modem_settings`, and `coronium_get_webhook` / `coronium_set_webhook` (modem-lifecycle auto-swap webhook).

**`coronium_list_tariffs`** now surfaces the additive `ip_stack: {ipv4, ipv6, native_ipv6}` field from `/tariffs/available`.

**Carried over from 1.2.x:** auto-login (set `CORONIUM_LOGIN`/`CORONIUM_PASSWORD` once — any 401 transparently re-mints and retries), live coin pricing (USD valuations from CoinGecko, 60s cache), and the modular codebase (`src/{config,logger,token-store,api-client,prices,formatters}.ts` + `src/tools/{auth,account,pool,proxies,shop,tickets}.ts`).

## Pool Gateway (pay-per-GB)

Two ways to get a Coronium proxy:

| | **Dedicated modem** (the classic product) | **Pool Gateway** (new in 1.3.0) |
|---|---|---|
| What you get | One real SIM in one real device, yours for the tariff period | A metered credential into a shared mobile pool, billed per GB |
| Billing | Flat tariff (subscription) | Pay-per-GB from your account balance |
| Buy with | `coronium_buy_modems_with_balance` | `coronium_buy_pool_with_balance` (pass a **pool** `tariff_id` from `coronium_list_tariffs`) |
| Use | `coronium_get_proxy` → credentials on a dedicated host | `coronium_build_pool_proxy_url` → `gw.proxies.sx` + a `pak_` key |
| Best for | Account warming, held IP, full device control | Scraping, bursty/elastic GB, many countries without one modem each |

The Pool Gateway is the same metered mobile pool offered by **[Proxies.sx](https://proxies.sx)** — Coronium resells access to it from your balance. If you are a **wallet-only AI agent** that wants to buy pool access directly with **USDC** (no account, x402 protocol), use the Proxies.sx agent path instead: `GET https://api.proxies.sx/v1/x402/pool` (see <https://agents.proxies.sx>). This Coronium MCP is the right tool when you already have a Coronium balance.

Typical flow: `coronium_list_tariffs` (find a pool tariff) → `coronium_buy_pool_with_balance` → `coronium_build_pool_proxy_url` → use it → `coronium_topup_pool_key` when GB runs low. Sessions: `coronium_list_pool_sessions` / `coronium_close_pool_session`.

## Tool catalogue

### Auth (3)

| Tool | Description |
|------|-------------|
| `coronium_login` | Authenticate with email + password. Most other tools auto-login on 401, so explicit calls are only needed for re-auth or account switching. |
| `coronium_check_token` | Verify the cached token is still valid. |
| `coronium_logout` | Clear the encrypted token cache. |

### Account (9)

| Tool | Description |
|------|-------------|
| `coronium_get_account` | Profile, role, contact, business data, 2FA state. |
| `coronium_get_balance` | Unified multi-currency balance: account credit + crypto, all in USD with live prices. |
| `coronium_get_crypto_balance` | Crypto deposit addresses + balances (BTC/USDT/etc). Use these addresses to top up. |
| `coronium_get_credit_cards` | Saved Stripe cards (last-4 digits + brand). |
| `coronium_get_low_balance_threshold` | Get configured email-alert tiers (USD). |
| `coronium_set_low_balance_threshold` | Set email-alert tiers — backend allows tiers 100 / 300 / 500 (USD). |
| `coronium_get_payments` | Full payment + invoice ledger for the account (reconciliation, duplicate/overpayment detection). |
| `coronium_get_webhook` | Get the account's modem-lifecycle webhook config. |
| `coronium_set_webhook` | Set or clear the modem-lifecycle webhook — a dead modem auto-swaps and your HTTPS endpoint is notified. |

### Pool (8)

The pay-per-GB **Pool Gateway** tier (see [Pool Gateway](#pool-gateway-pay-per-gb)). Tools return HTTP 503 with a clear message if the pool tier is not enabled on your account.

| Tool | Description |
|------|-------------|
| `coronium_get_pool_stock` | Live pool stock availability (countries + counts). |
| `coronium_list_pool_keys` | List your pay-per-GB pool keys (status, traffic remaining, tariff). |
| `coronium_build_pool_proxy_url` | Build a usable proxy URL (or URLs) for an active pool key — host `gw.proxies.sx` + credentials. |
| `coronium_buy_pool_with_balance` | Buy a pool key using account balance. Pass a **pool** `tariff_id` (from `coronium_list_tariffs`). |
| `coronium_topup_pool_key` | Add traffic/credit to an existing pool key. |
| `coronium_cancel_pool_key` | Cancel a pool key. |
| `coronium_list_pool_sessions` | List your currently-open sticky pool sessions. |
| `coronium_close_pool_session` | Close one pool session (pass `session_key`) or all of them (omit it). |

### Proxies (16)

| Tool | Description |
|------|-------------|
| `coronium_get_proxies` | List proxies with optional filters (`country_code`, `online_only`, `expiring_within_days`). |
| `coronium_get_proxy` | Full detail for one proxy by `_id` or name (credentials, expiry, external IP, rotation interval). |
| `coronium_restart_modem` | Authenticated rotation (new IP) via `/v3/modems/:id/restart`. |
| `coronium_get_rotation_status` | Poll real-time rotation status (`idle` / `rotating` / `success` / `failed`) + current/previous IP. |
| `coronium_rotate_modem` | Token-based rotation via the public reset service (no API token needed). |
| `coronium_test_modem` | Live connectivity probe through the proxy. |
| `coronium_replace_modem` | Swap a broken/dead modem for a working one of the same country/tariff (subscription transfers). |
| `coronium_set_rotation_interval` | Configure auto-rotation cadence in seconds (0 = manual only). |
| `coronium_change_proxy_password` | Rotate the HTTP/SOCKS proxy password (new random password returned). |
| `coronium_set_modem_metadata` | Free-form label/note on a modem. |
| `coronium_set_modem_os` | Set the p0f OS fingerprint preset (Android / iOS / Windows / etc). |
| `coronium_cancel_modem` | Cancel auto-renew (modem stays usable until current expiry). |
| `coronium_get_openvpn_config` | Download the `.ovpn` config (when the modem supports VPN tunnel access). |
| `coronium_get_proxy_health` | Liveness/health snapshot for all your proxies (per-modem reachability + recommendation). |
| `coronium_get_p0f_options` | List valid OS fingerprint values accepted by `coronium_set_modem_os` for a modem. |
| `coronium_apply_modem_settings` | Re-apply / re-push a modem's settings (`POST /modems/:id/apply-settings`). |

### Shop (7)

| Tool | Description |
|------|-------------|
| `coronium_list_countries` | Countries with stock + free-modem counts. |
| `coronium_list_tariffs` | Available price plans (with optional country filter). |
| `coronium_list_free_modems` | Live free-modem inventory. |
| `coronium_check_coupon` | Validate a coupon code. |
| `coronium_buy_modems_with_balance` | Buy 1+ modems using account credit. |
| `coronium_renew_modems_with_balance` | Renew existing modems. |
| `coronium_get_payment_status` | Check status of a payment by id. |

### Tickets (5)

| Tool | Description |
|------|-------------|
| `coronium_list_tickets` | List your tickets (filter by `open` / `closed` / `all`). |
| `coronium_get_ticket` | Full ticket detail with replies. |
| `coronium_create_ticket` | Open a new ticket. |
| `coronium_reply_to_ticket` | Add a reply. |
| `coronium_archive_ticket` | Close from the customer side. |

## Environment

```bash
cp .env.example .env
# edit .env with your credentials
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `CORONIUM_LOGIN` | — | Account email |
| `CORONIUM_PASSWORD` | — | Account password |
| `CORONIUM_BASE_URL` | `https://api.coronium.io/api/v3` | Canonical production API base. The OpenAPI spec at https://dashboard.coronium.io/api-docs/ lists this as the single supported server URL. |
| `CORONIUM_ROTATION_URL` | `https://mreset.xyz` | Token-based rotation endpoint |
| `CORONIUM_PRICES_URL` | `https://api.coingecko.com/api/v3/simple/price` | Coin price source |
| `CORONIUM_AUTO_LOGIN` | `1` | Set to `0` to disable transparent re-auth on 401 |
| `TOKEN_ENCRYPTION_KEY` | random per process | Pin to a 64-hex value to keep cache across restarts |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

## Security

- Tokens encrypted at rest with AES-256-CBC under a scrypt-derived key
- Credentials live in env vars or `.env` — never written to source files
- Cache directory: `~/.coronium/` (token + crypto deposit addresses)
- All logging goes to **stderr**; stdout is reserved for MCP JSON-RPC

## Development

```bash
npm run dev           # tsx watch mode
npm test              # vitest
npm run build         # tsc → dist/
npm run typecheck     # tsc --noEmit

LOG_LEVEL=debug npm run dev
```

## Sibling project — wallet-bound MCP

For agent-native onboarding (no email/password — wallet keypair + voucher), see [`@coronium/mcp`](https://www.npmjs.com/package/coronium-mcp) in the [`coronium-ai`](https://github.com/bolivian-peru/coronium-ai) monorepo. Tool surfaces are intentionally similar so an agent can substitute one for the other based on the user's auth model.

## Support

- Issues: [GitHub](https://github.com/coroniumio/coronium-proxy-mcp/issues)
- Email: hello@coronium.io
- Dashboard: [dashboard.coronium.io](https://dashboard.coronium.io)
- Buy proxies: [coronium.io/buy-mobile-proxies](https://www.coronium.io/buy-mobile-proxies)

## License

MIT — see [LICENSE](LICENSE).
