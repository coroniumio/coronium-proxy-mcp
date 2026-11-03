# Coronium proxy MCP

A local **stdio MCP server** for customers of Coronium.io dedicated 4G/5G mobile proxies. Version 2.4.2. It lets an AI agent check balances, list owned proxies with ready-to-use HTTP and SOCKS5 URLs, test and rotate proxies, replace a proxy, download an OpenVPN profile, compare plans and live stock by country and carrier, quote a purchase or a renewal, and work with support tickets. If you turn spending on, it can also buy and renew from your account balance or a saved card, and move your own USDT or BTC into account credit, after you approve the exact total. Started without a token, it can open a new account for an agent (see [Agents without a browser](#agents-without-a-browser)).

It talks only to the Coronium customer API at `https://api.coronium.io/api/v3` (plus the public plan catalog on the same host). It has no admin, server or reseller-management tools. The same tools are also run by Coronium as a [hosted server](#hosted-server) at `https://api.coronium.io/mcp`, for claude.ai, the Claude apps and Cowork, with sign-in through your Coronium account. Upgrading from 1.3.0 or 2.0.0? Read the [migration notes](CHANGELOG.md).

## Connect

Requires **Node.js 20 or newer**. Configure your MCP host to launch the pinned version:

```json
{
  "mcpServers": {
    "coronium": {
      "command": "npx",
      "args": ["-y", "coronium-proxy-mcp@2.4.2"],
      "env": {
        "CORONIUM_API_TOKEN": "YOUR_CORONIUM_API_TOKEN",
        "CORONIUM_TOOL_PROFILE": "directory"
      }
    }
  }
}
```

Create the API token in the dashboard (dashboard.coronium.io, Account, API Access). Keep it in your host's protected configuration or secret store, never in a repository or a conversation. `CORONIUM_API_KEY` is an alias for `CORONIUM_API_TOKEN`. Restart the host after changing configuration.

The token is the way in. No account yet? See [Agents without a browser](#agents-without-a-browser). There is no password tool by default: `coronium_login` only exists if you set `CORONIUM_ENABLE_LOGIN_TOOL=1`, because a password passed to a tool ends up in the conversation.

If you want an agent to buy for you, use the `buyer` profile and turn spending on:

```json
{
  "mcpServers": {
    "coronium": {
      "command": "npx",
      "args": ["-y", "coronium-proxy-mcp@2.4.2"],
      "env": {
        "CORONIUM_API_TOKEN": "YOUR_CORONIUM_API_TOKEN",
        "CORONIUM_TOOL_PROFILE": "buyer",
        "CORONIUM_ENABLE_SPENDING": "1"
      }
    }
  }
}
```

Leave `CORONIUM_ENABLE_SPENDING` out and the same profile can look, quote and manage, but not pay.

Set the host's tool timeout above **180 seconds**: rotation, replacement and payment calls wait for the backend. If a call times out, check its outcome before acting again. The process uses stdout only for MCP JSON-RPC.

## Agents without a browser

An agent can open its own Coronium account, fund it and buy, with no browser and no dashboard visit. Nothing is included until it is paid for, and every purchase still needs the person's yes for the exact total.

**With this MCP (stdio).** Start it with no `CORONIUM_API_TOKEN` and the `buyer` profile. `coronium_create_account` (email, name, optional purpose and password) signs up, signs in and issues an API token, which the rest of the session uses. It returns the API token once, and the generated password once if you gave none; store both in a secret store. Then: `coronium_get_crypto_balance`, deposit USDT (TRC-20) or BTC, `coronium_convert_crypto_to_credit` (dry run, then confirmed), `coronium_quote_purchase`, and `coronium_buy_modems_with_balance` with `funding_source: "account_credit"`.

```json
{
  "mcpServers": {
    "coronium": {
      "command": "npx",
      "args": ["-y", "coronium-proxy-mcp@2.4.2"],
      "env": {"CORONIUM_TOOL_PROFILE": "buyer", "CORONIUM_ENABLE_SPENDING": "1"}
    }
  }
}
```

**With curl.** The same steps against the REST API (`jq` reads the JSON):

```bash
API=https://api.coronium.io
EMAIL=agent@your-domain.example; PASSWORD='a-long-random-password'
# 1. Sign up (a verification email is sent; nothing waits for it)
curl -s -X POST $API/api/v3/signup -H 'Content-Type: application/json' \
  -d "{\"login\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"My agent\",\"purpose\":\"price monitoring\"}"
# 2. Sign in, then issue the long-lived API token (365 days)
SESSION=$(curl -s -X POST $API/api/v3/get-token -H 'Content-Type: application/json' \
  -d "{\"login\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .token)
TOKEN=$(curl -s $API/api/v1/account/api-token -H "Authorization: Bearer $SESSION" | jq -r .token)
# 3. Deposit addresses: send USDT (TRC-20) or BTC and wait for it to confirm
curl -s $API/api/v3/account/crypto-balance -H "Authorization: Bearer $TOKEN"
# 4. Move it into USD account credit: preview, then the real move (one way)
curl -s -X POST $API/api/v3/account/balance/convert -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"coin":"all","dry_run":true}'
curl -s -X POST $API/api/v3/account/balance/convert -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' -d '{"coin":"all"}'
# 5. Plans and stock; the total is price x quantity
curl -s $API/api/v3/tariffs/available | jq '.data[] | {_id, name, country_code, price, period, stock}'
# 6. Buy, capped at the approved total; then read the proxies
curl -s -X POST $API/api/v3/payment/buy-with-account-credit -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"tariff_id":"TARIFF_ID","modemCount":1,"max_total_usd":APPROVED_TOTAL}'
curl -s $API/api/v3/account/proxies -H "Authorization: Bearer $TOKEN"
```

Disposable and reserved email domains are refused. An address that already has an account signs up "ok" but the sign-in fails with a different password.

**Hosted buyer server with the API token.** Send the token as a Bearer header to `https://api.coronium.io/mcp/buyer`. That token can buy there, exactly as it can on the REST API, so keep it secret (environment variable or secret store, never in a repository or a chat). `https://api.coronium.io/mcp` never spends with any token.

```bash
claude mcp add --transport http coronium-buyer https://api.coronium.io/mcp/buyer \
  --header "Authorization: Bearer $CORONIUM_API_TOKEN"
```

Any MCP client that supports Streamable HTTP with headers:

```json
{
  "mcpServers": {
    "coronium-buyer": {
      "type": "http",
      "url": "https://api.coronium.io/mcp/buyer",
      "headers": {"Authorization": "Bearer ${CORONIUM_API_TOKEN}"}
    }
  }
}
```

`${CORONIUM_API_TOKEN}` is expanded by Claude Code; in a client without variable expansion, keep this file out of version control.

## Hosted server

Coronium runs this server over Streamable HTTP, so it works where a local server cannot: claude.ai, the Claude desktop and mobile apps, and Cowork, as well as Claude Code.

**Works in claude.ai:** add a custom connector with the URL `https://api.coronium.io/mcp`, then sign in with your Coronium account. A Coronium page opens; sign in to your dashboard in that browser if needed, check the app and the permissions, and approve. Nothing to install and no token to copy.

**Claude Code:** `claude mcp add --transport http coronium https://api.coronium.io/mcp`, then `/mcp` to sign in. The Claude Code plugin in this repository declares the same URL as its only server, `coronium`.

How it works:

- Sign-in is OAuth 2.1 with PKCE (S256). Clients register dynamically or with a client ID metadata document. Access tokens last one hour; refresh tokens rotate on every use, and a reused refresh token ends that sign-in. Coronium stores only hashes of tokens.
- `https://api.coronium.io/mcp` runs the `directory` profile (22 tools). Permissions: `read` (account, balance, proxies, plans, prices, tickets) and `manage` (test, rotate and replace proxies, OpenVPN profiles, open and answer tickets). It has no tools that buy, renew, top up, cancel or refund, whatever you approve.
- `https://api.coronium.io/mcp/buyer` is a separate address for agents that buy, for use as a custom connector. It runs the `buyer` profile: 15 tools, or 20 when the connection may spend (the two buy tools, the two renew tools and `convert_crypto_to_credit`). Purchases are off for every OAuth connection: the money tools appear only after you allow purchases for that one connection, on the consent page or later in the dashboard, with your password. Each purchase still needs `confirm: true`, the quoted `expected_total_usd` and a new `idempotency_key`, and the API refuses a higher total.
- See and disconnect connected apps at https://dashboard.coronium.io/api/v1/oauth/connections while signed in to the dashboard. Disconnecting stops an app at once.
- API clients can also send a dashboard API token as the Bearer token. On `/mcp` it gets `read` and `manage` and never spends. On `/mcp/buyer` it also gets `spend`, the same power it has on the REST API, so the money tools are listed without a dashboard switch. Keep it secret. `coronium_get_capabilities` reports the rule as `spending_rule`.
- The hosted server never lists `create_account`. Open the account first with the local server or the REST API (see [Agents without a browser](#agents-without-a-browser)), then connect with its API token.
- The hosted server keeps no customer data. Its logs hold the tool name and argument names, never values, credentials or ticket text.

Run your own copy over HTTP with `npx -y -p coronium-proxy-mcp@2.4.2 coronium-proxy-mcp-http` behind a TLS proxy. It needs an OAuth authorization server that answers the token check described in `src/remote-auth.ts`; settings: `PORT` (default 5031), `HOST` (default 127.0.0.1), `MCP_PUBLIC_URL`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS` and `CORONIUM_BASE_URL`. It refuses to start with `CORONIUM_API_TOKEN`, a password or `CORONIUM_ENABLE_SPENDING` in its environment, because it only acts with each caller's own sign-in.

## Install from a listing

[![coroniumio/coronium-proxy-mcp MCP server](https://glama.ai/mcp/servers/coroniumio/coronium-proxy-mcp/badges/score.svg)](https://glama.ai/mcp/servers/coroniumio/coronium-proxy-mcp)

- **Claude Code plugin** (hosted directory server, no money tools; sign in with your Coronium account in the browser, no token):
  ```
  /plugin marketplace add coroniumio/coronium-proxy-mcp
  /plugin install coronium-mobile-proxies@coronium
  ```
  Then run `/mcp`, select `plugin:coronium-mobile-proxies:coronium` and choose Authenticate. Details: [plugins/coronium-mobile-proxies](plugins/coronium-mobile-proxies#readme).
- **Official MCP Registry**: `io.github.coroniumio/coronium-proxy-mcp` ([registry entry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.coroniumio/coronium-proxy-mcp)). Hosts that read the registry install the npm package `coronium-proxy-mcp` or connect to the hosted remote `https://api.coronium.io/mcp`.
- **npm**: `npx -y coronium-proxy-mcp@2.4.2` with the environment shown under [Connect](#connect).
- **Glama**: [glama.ai/mcp/servers/coroniumio/coronium-proxy-mcp](https://glama.ai/mcp/servers/coroniumio/coronium-proxy-mcp).

## Tool profiles

`CORONIUM_TOOL_PROFILE` decides which tools exist:

- `directory` registers an explicit allowlist of 22 tools: balances (account credit, BTC and USDT), owned proxies with HTTP and SOCKS5 URLs, ready-to-use connection config (`get_proxy_connection`), health, connectivity test, rotation and its status, replacement, OpenVPN profile, countries, plans and stock by country and carrier, renewal quotes, tickets (list, read, create, reply), webhook read, and capabilities. It has no login tool, no OS fingerprint tools, no wallet creation, and no buy, renew, top-up or cancel tools. `check_token` takes no token argument. This is the profile the Coronium Claude Code plugin uses.
- `buyer` registers 15 tools for an agent that buys and runs a few dedicated proxies, 20 with spending on: plans, stock, `quote_purchase`, `get_renewal_quote`, payment status, owned proxies, `get_proxy_connection`, test, rotate and rotation status, replace, balance, crypto balance, saved cards and capabilities. With spending on it adds `buy_modems_with_balance`, `buy_modems_with_card`, `renew_modems_with_balance`, `renew_modems_with_card` and `convert_crypto_to_credit`. Without any configured token or login it also lists `create_account` (16 tools, 21 with spending on; see [Agents without a browser](#agents-without-a-browser)). No login tool and no token argument anywhere.
- `full` (the default when unset) registers every non-money tool, including settings, webhooks, pool keys and the Coronium Node tools: 60 tools, 69 with spending on. Like `buyer`, it also lists `create_account` while no token or login is configured (61, or 70 with spending on). The login tool is not included unless `CORONIUM_ENABLE_LOGIN_TOOL=1`.
- `read-only` registers only the 32 tools that change nothing. `CORONIUM_READ_ONLY=true` is an alias.

**Spending is off by default.** Money tools exist only when `CORONIUM_ENABLE_SPENDING=1` is set **and** the profile is `full` (buy, renew, crypto to credit, pool purchase and top-up, cancel with refund) or `buyer` (buy, renew and crypto to credit). Without both, they are not registered and the HTTP client refuses money calls on its own (`spending_disabled`). Otherwise you pay in the dashboard.

Tools are always listed in alphabetical order, so the list is the same in every session.

### Configuration

- `CORONIUM_API_TOKEN` (or `CORONIUM_API_KEY`): the dashboard API token, kept in memory only. Leave it unset in the `buyer` or `full` profile to let an agent open its own account with `create_account`.
- `CORONIUM_TOOL_PROFILE`: `buyer`, `directory`, `full` or `read-only`. Any other value stops the server at startup.
- `CORONIUM_ENABLE_SPENDING`: `1` or `true` enables money tools in the `full` and `buyer` profiles. Default off.
- `CORONIUM_ENABLE_LOGIN_TOOL`: `1` or `true` registers `coronium_login` and `coronium_logout` in the `full` and `read-only` profiles. Default off. Never in `buyer` or `directory`.
- `CORONIUM_BASE_URL`: defaults to `https://api.coronium.io/api/v3` when unset or empty. An override must be HTTPS (loopback HTTP is allowed for tests) and must not contain credentials, a query or a fragment. Leave it unset in normal use so the token only goes to Coronium.

`CORONIUM_ENABLE_SPENDING`, `CORONIUM_ENABLE_LOGIN_TOOL` and `CORONIUM_BASE_URL` are read only from the host's environment or from the file named by `DOTENV_CONFIG_PATH`. A `.env` file that happens to be in the working directory cannot turn spending on or redirect the token.
- `CORONIUM_LOGIN` (or `CORONIUM_EMAIL`) and `CORONIUM_PASSWORD`: older login from the host environment instead of a token. Still works, but prefer the token.
- `CORONIUM_AUTO_LOGIN`: `0` disables automatic login and refresh.
- `TOKEN_ENCRYPTION_KEY`: optional secret that lets a login token persist AES-256-GCM encrypted at `~/.coronium/token.enc` (directory 0700, file 0600). Without it nothing is written to disk.
- `DOTENV_CONFIG_PATH`: optional explicit `.env` path.

## How the tools behave

**Proxies and URLs.** `get_proxies` and `get_proxy` return `http_url` and `socks5_url`. When a proxy has separate HTTP and SOCKS5 logins, each URL uses its own login. Listing does not test a connection; `test_modem` runs the backend check and returns `ok:true` or `ok:false`.

**Connection config.** `get_proxy_connection` returns, for one owned proxy: the HTTP and SOCKS5 URLs, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` values and `export` lines, and snippets for curl, Python requests and httpx, Node undici and axios, Playwright, Puppeteer and Selenium (selenium-wire), plus country, carrier, expiry and the rotation link when the account has one. `protocol` picks the URL for env vars and URL snippets; browsers always use the HTTP endpoint. Every value comes from the account's proxy record; a missing one is null. The result is a secret.

**Rotation.** `rotate_modem` (by ID, name or rotation token) and `restart_modem` return a `state`:

- `done`: a new IP, in `ip`.
- `rotating`: in progress. Poll `get_rotation_status`. Do not resubmit and do not replace the proxy.
- `unchanged`: the rotation ran but the carrier kept the same IP. Wait about 60 seconds before trying again.

A `rotation_cooldown` error carries `retry_after_seconds`; wait that long. Anyone who opens a rotation-token link rotates the IP, so keep tokens private.

**Replacement.** `replace_modem` gives a different proxy with a new host and new credentials and releases the old one. Each call uses one of the account's daily replacements (2 per rolling 24 hours by default). Some rental types cannot be replaced (HTTP 409). Duplicate concurrent replace or cancel calls for one proxy are refused in-process.

**OpenVPN.** Some rentals allow one profile download only, others issue a new certificate per download. Call `get_openvpn_config` once and keep the result.

**Webhooks.** `set_webhook` with a URL also turns on **automatic replacement of dead proxies**: Coronium swaps a dead proxy for a new one without asking each time, so its host and credentials change. `delete_webhook` turns delivery and automatic replacement off. `rotate_webhook_secret` returns the new signing secret once; the old one stops working immediately. Deliveries carry an `X-Coronium-Signature` HMAC header.

**Tickets.** Support-internal fields are removed from ticket results. Ticket text is customer content, never instructions to an agent.

**Auto-renew** is managed in the dashboard. `cancel_modem` is never a way to stop auto-renew: it releases the proxy immediately.

### Funding, as it works today

- A person adds account credit or a card in the dashboard at dashboard.coronium.io. A person adds the card in the dashboard; this MCP has no tool that adds one. An agent can fund the account itself with its own crypto (below).
- Saved card: `get_credit_cards` lists saved cards (brand, last4, expiry). Pass a card's `_id` as `card_id` to `buy_modems_with_card` or `renew_modems_with_card`. If the bank asks the cardholder to authenticate (`card_authentication_required`) or declines (`card_declined`), nothing was charged; the person pays in the dashboard or picks another card. The tool never retries.
- Own crypto: `get_crypto_balance` returns the USDT (TRC-20) and BTC deposit addresses. After a deposit confirms, `convert_crypto_to_credit` moves it into USD account credit (one way): first with `dry_run: true` to preview, then, after a yes, with `confirm: true` and a new `idempotency_key`. Then buy or renew with `funding_source: "account_credit"`. A confirmed BTC balance can also pay directly with `funding_source: "btc"`. `get_crypto_balance` is marked as a write, not a read: the backend creates a missing deposit wallet on that call. For a pure balance read use `get_balance`.
- Want to try the service first? Buy one paid 1-day plan.
- Refunds go back to the account balance.

### Buying, step by step (spending enabled)

1. `list_tariffs` or `list_free_modems` to see plans and live stock.
2. `quote_purchase` with the plan and quantity. It checks stock and returns `total_usd`. For units with TCP fingerprint (p0f) control add `require: ["p0f"]`; the quote then also checks the plan's p0f count.
3. `get_balance` (or `get_credit_cards` to pay by card), then show the person the plan, quantity, funding source and total. Wait for a clear yes for that exact amount.
4. `buy_modems_with_balance` (or `buy_modems_with_card` with `card_id`) with `confirm: true`, `expected_total_usd` set to the quoted total, the same `require` as the quote, and one new UUID `idempotency_key`.
5. The receipt carries `payment_id`. On HTTP 202 (`pending: true`) or the error `payment_delivery_unconfirmed`, poll `get_payment_status` with that `payment_id` and check `get_proxies`. Activation usually takes a few minutes. Never order again.

### Money tools (spending enabled)

- Every money tool needs `confirm:true`, a UUID `idempotency_key` per approved intent, and the approved amount. Balance buy and renew also need an explicit `funding_source` (`account_credit` or `btc`; no default); the card tools need `card_id`. `convert_crypto_to_credit` previews with `dry_run: true` and needs `confirm` and a key only for the real move.
- `expected_total_usd`: the tool re-reads the live price (plan price and coupon, renewal quote, or pool plan price) right before sending and refuses with `price_changed` when the total differs from the approved one, higher or lower. Buy and renew also send it to the server as `max_total_usd`, so the server refuses (HTTP 409 `price_changed`, nothing charged, `details.quote` holds its current figure) when its total is higher. Neither is a price lock. After `price_changed`, quote again, ask again, and use a new `idempotency_key` for the newly approved total.
- `idempotency_key` is sent as the `Idempotency-Key` header on every buy, renew and crypto move. A repeat call with a key the account already sent (within 24 hours, in the same server process) skips the pre-checks and returns the first receipt, or the first error, with `replay: true`. It never charges again, even when the first call bought the last unit in stock. The same key with a different payload is refused (`idempotency_conflict`). The key is 8 to 128 characters of letters, digits, `-` and `_` (a UUID fits); the API answers HTTP 400 "Invalid Idempotency-Key format" to any other key on the buy, renew and crypto-move routes.
- `cancel_modem` needs `min_refund_usd`. It re-runs the refund preview and refuses with `refund_changed` when the refund is now lower.
- A coupon that gives no discount is refused (`coupon_invalid`) instead of being charged at full price.
- `require: ["p0f"]` buys only units with p0f control and is refused before any charge (`p0f_unavailable`) when the plan has too few. `want_p0f: true` is a deprecated alias for it.
- Buy and renew results carry `payment_id`, `pending` and `next_step`; an error with a known payment carries `payment_id` too. Poll `get_payment_status` with it. Without one, reconcile with `get_payments` and `get_proxies`. `outcome:"unknown"` means check before acting; `outcome:"refunded_not_charged"` means nothing was charged.
- No write is ever retried automatically. A payment key is bound to one payload for the process lifetime and concurrent identical calls share one request.

## Results and errors

Successful tools return JSON text and `structuredContent` with the same `{data, observed_at}` object. `observed_at` is when this process handled the response, not a backend measurement time.

Errors set `isError:true` and carry `{error}` as JSON text (not `structuredContent`, which always matches the tool's output schema). `error` has `code` (always lowercase, for example `payment_in_progress`), `message`, `recovery_hint` (one sentence on what to do next), and when known `status`, `backend_code` (the original code when it differed), `request_id`, `retry_after_seconds`, `idempotency_key`, `outcome` and `suggested_action`. A 429 is classified by status and `Retry-After`, not by its code. When a plan is out of stock, the error lists up to five plans that are in stock now. Credential fields are redacted from error details. A failed balance read is an error, never zero.

## Tool catalog

Every name begins with `coronium_`. "buyer" and "directory" mark the tools in those profiles. Exact arguments come from `tools/list`. The catalog lists all 72 tool schemas (also in `docs/tool-catalog.json`): 70 tools plus the opt-in `coronium_login` and `coronium_logout`. Of the 70, nine move money and need `CORONIUM_ENABLE_SPENDING=1`.

<!-- TOOL_CATALOG -->
- `coronium_apply_modem_settings` (write). Required: `proxy`, `confirm`.
- `coronium_archive_ticket` (write). Required: `ticket_id`, `confirm`.
- `coronium_build_pool_proxy_url` (write). Required: `id`.
- `coronium_build_saved_pool_session_url` (write). Required: `id`.
- `coronium_buy_modems_with_balance` (spends money, needs CORONIUM_ENABLE_SPENDING=1, buyer). Required: `tariff_id`, `quantity`, `expected_total_usd`, `confirm`, `idempotency_key`, `funding_source`.
- `coronium_buy_modems_with_card` (spends money, needs CORONIUM_ENABLE_SPENDING=1, buyer). Required: `tariff_id`, `quantity`, `expected_total_usd`, `confirm`, `idempotency_key`, `card_id`.
- `coronium_buy_pool_with_balance` (spends money, needs CORONIUM_ENABLE_SPENDING=1). Required: `tariff_id`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_cancel_modem` (cancels with refund, needs CORONIUM_ENABLE_SPENDING=1). Required: `proxy`, `min_refund_usd`, `confirm`.
- `coronium_cancel_pool_key` (cancels with refund, needs CORONIUM_ENABLE_SPENDING=1). Required: `id`, `confirm`, `idempotency_key`.
- `coronium_change_proxy_password` (write). Required: `proxy`, `confirm`.
- `coronium_check_coupon` (read). Required: `code`.
- `coronium_check_token` (read, directory). Required: none.
- `coronium_close_pool_session` (write). Required: `confirm`.
- `coronium_convert_crypto_to_credit` (spends money, needs CORONIUM_ENABLE_SPENDING=1, buyer). Required: none.
- `coronium_create_account` (write, buyer). Required: `email`, `name`.
- `coronium_create_ticket` (write, directory). Required: `subject`, `message`, `confirm`.
- `coronium_delete_saved_pool_session` (write). Required: `id`, `confirm`.
- `coronium_delete_webhook` (write). Required: `confirm`.
- `coronium_get_account` (read, directory). Required: none.
- `coronium_get_balance` (read, buyer, directory). Required: none.
- `coronium_get_capabilities` (read, buyer, directory). Required: none.
- `coronium_get_credit_cards` (read, buyer). Required: none.
- `coronium_get_crypto_balance` (write, buyer). Required: none.
- `coronium_get_low_balance_threshold` (read). Required: none.
- `coronium_get_openvpn_config` (write, directory). Required: `proxy`.
- `coronium_get_p0f_options` (read). Required: `proxy`.
- `coronium_get_payment_status` (read, buyer). Required: `payment_id`.
- `coronium_get_payments` (read). Required: none.
- `coronium_get_pool_carriers` (read). Required: `country`.
- `coronium_get_pool_stock` (read). Required: none.
- `coronium_get_proxies` (read, buyer, directory). Required: none.
- `coronium_get_proxy` (read, directory). Required: `proxy`.
- `coronium_get_proxy_connection` (read, buyer, directory). Required: `modem_id`.
- `coronium_get_proxy_health` (read, directory). Required: none.
- `coronium_get_renewal_quote` (read, buyer, directory). Required: `modems`.
- `coronium_get_rotation_status` (read, buyer, directory). Required: `proxy`.
- `coronium_get_speed_test` (read). Required: `proxy`.
- `coronium_get_subscriptions` (read). Required: none.
- `coronium_get_ticket` (read, directory). Required: `ticket_id`.
- `coronium_get_usage` (read). Required: `proxy`.
- `coronium_get_webhook` (read, directory). Required: none.
- `coronium_list_countries` (read, directory). Required: none.
- `coronium_list_free_modems` (read, buyer, directory). Required: none.
- `coronium_list_pool_keys` (write). Required: none.
- `coronium_list_pool_sessions` (read). Required: none.
- `coronium_list_pool_tariffs` (read). Required: none.
- `coronium_list_saved_pool_sessions` (read). Required: none.
- `coronium_list_tariffs` (read, buyer, directory). Required: none.
- `coronium_list_tickets` (read, directory). Required: none.
- `coronium_login` (opt-in, needs CORONIUM_ENABLE_LOGIN_TOOL=1). Required: none.
- `coronium_logout` (opt-in, needs CORONIUM_ENABLE_LOGIN_TOOL=1). Required: none.
- `coronium_preview_modem_cancellation` (read). Required: `proxy`.
- `coronium_quote_purchase` (read, buyer). Required: `tariff_id`, `quantity`.
- `coronium_renew_modems_with_balance` (spends money, needs CORONIUM_ENABLE_SPENDING=1, buyer). Required: `modems`, `funding_source`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_renew_modems_with_card` (spends money, needs CORONIUM_ENABLE_SPENDING=1, buyer). Required: `modems`, `card_id`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_replace_modem` (write, buyer, directory). Required: `proxy`, `confirm`.
- `coronium_reply_to_ticket` (write, directory). Required: `ticket_id`, `message`, `confirm`.
- `coronium_restart_modem` (write). Required: `proxy`, `confirm`.
- `coronium_revoke_openvpn` (write). Required: `proxy`, `confirm`.
- `coronium_rotate_modem` (write, buyer, directory). Required: `proxy_identifier`, `confirm`.
- `coronium_rotate_webhook_secret` (write). Required: `confirm`.
- `coronium_save_pool_session` (write). Required: `pool_key_id`, `label`, `params`.
- `coronium_set_low_balance_threshold` (write). Required: `thresholds`.
- `coronium_set_modem_metadata` (write). Required: `proxy`, `metadata`.
- `coronium_set_modem_os` (write). Required: `proxy`, `os`, `confirm`.
- `coronium_set_rotation_interval` (write). Required: `proxy`, `interval_seconds`, `confirm`.
- `coronium_set_webhook` (write). Required: `webhook_url`, `confirm`.
- `coronium_set_white_list` (write). Required: `proxy`, `white_list`, `confirm`.
- `coronium_start_speed_test` (write). Required: `proxy`, `confirm`.
- `coronium_test_modem` (write, buyer, directory). Required: `proxy`.
- `coronium_test_webhook` (write). Required: `confirm`.
- `coronium_topup_pool_key` (spends money, needs CORONIUM_ENABLE_SPENDING=1). Required: `id`, `tariff_id`, `expected_total_usd`, `confirm`, `idempotency_key`.
<!-- /TOOL_CATALOG -->

## Develop and verify

```sh
npm ci
npm run check
npm run docs:check
npm run test:package
```

Tests run against a loopback backend with synthetic credentials and a temporary home directory. `test/fixtures/v3-routes.json` lists the public `/api/v3` routes (method, path, auth and field shapes only), and a test checks that every tool's routes exist in it. No test spends money, rotates a real proxy, sends a ticket or touches production. The optional `npm run test:public` makes four unauthenticated catalog reads against production and is not part of CI.

Publishing uses `.github/workflows/publish.yml` on a `publish-v<version>` tag or a manual run from main, with npm trusted publishing or an `NPM_TOKEN` secret. After the npm release, `.github/workflows/mcp-registry.yml` publishes `server.json` to the MCP Registry on a `registry-v<version>` tag, signing in with GitHub OIDC.

## Acceptable use

Coronium proxies are for lawful purposes such as app and website QA, ad verification, localisation testing and monitoring public information. Follow Coronium's Terms (https://www.coronium.io/terms-and-conditions) and the terms of every site you reach through a proxy. Do not use this server or Coronium proxies to create fake or bulk accounts, evade bans or rate limits, bypass security controls, send spam or commit fraud.

## Contact

hello@coronium.io for support and security reports. License: MIT.
