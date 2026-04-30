# Coronium Mobile Proxy MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Coronium.io](https://img.shields.io/badge/Coronium.io-Mobile%20Proxies-orange)](https://coronium.io)
[![Dashboard](https://img.shields.io/badge/Dashboard-Manage%20Proxies-green)](https://dashboard.coronium.io)
[![Version](https://img.shields.io/badge/Version-1.2.0-success)](https://github.com/coroniumio/coronium-proxy-mcp/releases)

MCP (Model Context Protocol) server for [Coronium.io](https://coronium.io) mobile (4G/5G) proxy management. Drive the full proxy lifecycle — list, rotate, replace, test, configure auto-rotation, buy, renew, manage subscriptions, open tickets — directly from Claude, Cursor, Cline, VS Code, Zed, Continue, and any other MCP-compatible host. Manage your account at [dashboard.coronium.io](https://dashboard.coronium.io).

> **v1.2.0** ships 34 tools (up from 6), full programmatic surface, live coin pricing, transparent token refresh, and a modular codebase. See [CHANGELOG.md](CHANGELOG.md) for details.

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

## What's new in 1.2.0

**Auto-login**: set `CORONIUM_LOGIN`/`CORONIUM_PASSWORD` once and forget about token management — any tool that hits a 401 transparently re-mints and retries. No more "your token expired, please run coronium_get_token".

**Live coin pricing**: balance views now show USD valuation pulled live from CoinGecko (60s in-memory cache, falls back gracefully on rate limit).

**34 tools** covering: auth, account, proxies (full lifecycle), shop (browse + buy + renew), and tickets. See [Tool catalogue](#tool-catalogue) below.

**Modular codebase**: `src/{config,logger,token-store,api-client,prices,formatters}.ts` plus `src/tools/{auth,account,proxies,shop,tickets}.ts`. The 2010-line single-file from 1.1.x is gone.

## Tool catalogue

### Auth (3)

| Tool | Description |
|------|-------------|
| `coronium_login` | Authenticate with email + password. Most other tools auto-login on 401, so explicit calls are only needed for re-auth or account switching. |
| `coronium_check_token` | Verify the cached token is still valid. |
| `coronium_logout` | Clear the encrypted token cache. |

### Account (6)

| Tool | Description |
|------|-------------|
| `coronium_get_account` | Profile, role, contact, business data, 2FA state. |
| `coronium_get_balance` | Unified multi-currency balance: account credit + crypto, all in USD with live prices. |
| `coronium_get_crypto_balance` | Legacy crypto-only view (BTC/USDT/etc with deposit addresses). |
| `coronium_get_credit_cards` | Saved Stripe cards (last-4 digits + brand). |
| `coronium_get_low_balance_threshold` | Get configured email-alert tiers (USD). |
| `coronium_set_low_balance_threshold` | Set email-alert tiers — e.g. `[100, 300]`. |

### Proxies (13)

| Tool | Description |
|------|-------------|
| `coronium_get_proxies` | List proxies with optional filters (`country_code`, `online_only`, `expiring_within_days`). |
| `coronium_get_proxy` | Full detail for one proxy by `_id` or name. |
| `coronium_restart_modem` | Authenticated rotation via `/v3/modems/:id/restart`. |
| `coronium_get_rotation_status` | Poll real-time rotation status (`idle` / `rotating` / `success` / `failed`). |
| `coronium_rotate_modem` | Token-based rotation via the public reset service (no API token needed). |
| `coronium_test_modem` | Live connectivity probe through the proxy. |
| `coronium_replace_modem` | Swap a broken modem for a working one (subscription transfers). |
| `coronium_set_rotation_interval` | Configure auto-rotation cadence in seconds (0 = manual only). |
| `coronium_change_proxy_password` | Rotate the HTTP/SOCKS proxy password. |
| `coronium_set_modem_metadata` | Free-form label, ≤200 chars. |
| `coronium_set_modem_os` | p0f Android/iOS/Windows/etc fingerprint preset. |
| `coronium_cancel_modem` | Cancel auto-renew (modem stays usable until current expiry). |
| `coronium_get_openvpn_config` | Download `.ovpn` config (when supported by the modem). |

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
