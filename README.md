# Coronium proxy MCP

A local **stdio MCP server** for customers of Coronium.io dedicated 4G/5G mobile proxies. Version 2.1.0. It lets an AI agent check balances, list owned proxies with ready-to-use HTTP and SOCKS5 URLs, test and rotate proxies, replace a proxy, download an OpenVPN profile, compare plans and live stock by country and carrier, get renewal quotes, and work with support tickets.

It talks only to the Coronium customer API at `https://api.coronium.io/api/v3` (plus the public plan catalog on the same host). It has no admin, server or reseller-management tools. Upgrading from 1.3.0 or 2.0.0? Read the [migration notes](CHANGELOG.md).

## Connect

Requires **Node.js 20 or newer**. Configure your MCP host to launch the pinned version:

```json
{
  "mcpServers": {
    "coronium": {
      "command": "npx",
      "args": ["-y", "coronium-proxy-mcp@2.1.0"],
      "env": {
        "CORONIUM_API_TOKEN": "YOUR_CORONIUM_API_TOKEN",
        "CORONIUM_TOOL_PROFILE": "directory"
      }
    }
  }
}
```

Create the API token in the dashboard (dashboard.coronium.io, Account, API Access). Keep it in your host's protected configuration or secret store, never in a repository or a conversation. `CORONIUM_API_KEY` is an alias for `CORONIUM_API_TOKEN`. Restart the host after changing configuration.

Set the host's tool timeout above **180 seconds**: rotation, replacement and payment calls wait for the backend. If a call times out, check its outcome before acting again. The process uses stdout only for MCP JSON-RPC.

## Tool profiles

`CORONIUM_TOOL_PROFILE` decides which tools exist:

- `directory` registers an explicit allowlist of 21 tools: balances (account credit, BTC and USDT), owned proxies with HTTP and SOCKS5 URLs, health, connectivity test, rotation and its status, replacement, OpenVPN profile, countries, plans and stock by country and carrier, renewal quotes, tickets (list, read, create, reply), webhook read, and capabilities. It has no login tool, no OS fingerprint tools, no wallet creation, and no buy, renew, top-up or cancel tools. `check_token` takes no token argument. This is the profile the Coronium Claude Code plugin uses.
- `full` (the default when unset) registers every non-money tool, including login, settings, webhooks, pool keys and the Coronium Node tools.
- `read-only` registers only tools that change nothing. `CORONIUM_READ_ONLY=true` is an alias.

**Spending is off by default.** Buy, renew, pool purchase and top-up, and cancel-with-refund tools exist only when `CORONIUM_TOOL_PROFILE=full` **and** `CORONIUM_ENABLE_SPENDING=1`. Without both, they are not registered and the HTTP client refuses money calls on its own (`spending_disabled`). Everyone else pays in the dashboard.

### Configuration

- `CORONIUM_API_TOKEN` (or `CORONIUM_API_KEY`): the dashboard API token, kept in memory only.
- `CORONIUM_TOOL_PROFILE`: `directory`, `full` or `read-only`. Any other value stops the server at startup.
- `CORONIUM_ENABLE_SPENDING`: `1` or `true` enables money tools in the `full` profile. Default off.
- `CORONIUM_BASE_URL`: defaults to `https://api.coronium.io/api/v3` when unset or empty. An override must be HTTPS (loopback HTTP is allowed for tests) and must not contain credentials, a query or a fragment. Leave it unset in normal use so the token only goes to Coronium.

`CORONIUM_ENABLE_SPENDING` and `CORONIUM_BASE_URL` are read only from the host's environment or from the file named by `DOTENV_CONFIG_PATH`. A `.env` file that happens to be in the working directory cannot turn spending on or redirect the token.
- `CORONIUM_LOGIN` (or `CORONIUM_EMAIL`) and `CORONIUM_PASSWORD`: optional login instead of a token, `full` profile only.
- `CORONIUM_AUTO_LOGIN`: `0` disables automatic login and refresh.
- `TOKEN_ENCRYPTION_KEY`: optional secret that lets a login token persist AES-256-GCM encrypted at `~/.coronium/token.enc` (directory 0700, file 0600). Without it nothing is written to disk.
- `DOTENV_CONFIG_PATH`: optional explicit `.env` path.

## How the tools behave

**Proxies and URLs.** `get_proxies` and `get_proxy` return `http_url` and `socks5_url`. When a proxy has separate HTTP and SOCKS5 logins, each URL uses its own login. Listing does not test a connection; `test_modem` runs the backend check and returns `ok:true` or `ok:false`.

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

### Money tools (full profile with spending enabled)

- Every money tool needs `confirm:true`, a UUID `idempotency_key` per approved intent, and the approved amount. Buy and renew also need an explicit `funding_source` (`account_credit` or `btc`; no default).
- `expected_total_usd`: the tool re-reads the current price (plan price and coupon, renewal quote, or pool plan price) right before sending and refuses with `price_changed` when the total is now higher. This is a client-side check, not a server price lock.
- `cancel_modem` needs `min_refund_usd`. It re-runs the refund preview and refuses with `refund_changed` when the refund is now lower.
- A coupon that gives no discount is refused (`coupon_invalid`) instead of being charged at full price.
- Purchase receipts have no payment ID. Reconcile with `get_payments` and `get_proxies`. `outcome:"unknown"` means check before acting; `outcome:"refunded_not_charged"` means nothing was charged.
- No write is ever retried automatically. A payment key is bound to one payload for the process lifetime and concurrent identical calls share one request.

## Results and errors

Successful tools return JSON text and `structuredContent` with the same `{data, observed_at}` object. `observed_at` is when this process handled the response, not a backend measurement time.

Errors set `isError:true` with `structuredContent.error`: `code` (always lowercase, for example `payment_in_progress`), `message`, and when known `status`, `backend_code` (the original code when it differed), `request_id`, `retry_after_seconds`, `idempotency_key`, `outcome` and `suggested_action`. A 429 is classified by status and `Retry-After`, not by its code. Credential fields are redacted from error details. A failed balance read is an error, never zero.

## Tool catalog

Every name begins with `coronium_`. "directory" marks the tools in the `directory` profile. Exact arguments come from `tools/list`.

<!-- TOOL_CATALOG -->
- `coronium_login` (auth). Required: none.
- `coronium_check_token` (read, directory). Required: none.
- `coronium_logout` (auth). Required: none.
- `coronium_get_account` (read, directory). Required: none.
- `coronium_get_balance` (read, directory). Required: none.
- `coronium_get_crypto_balance` (write). Required: none.
- `coronium_get_credit_cards` (read). Required: none.
- `coronium_get_low_balance_threshold` (read). Required: none.
- `coronium_set_low_balance_threshold` (write). Required: `thresholds`.
- `coronium_get_payments` (read). Required: none.
- `coronium_get_subscriptions` (read). Required: none.
- `coronium_get_webhook` (read, directory). Required: none.
- `coronium_set_webhook` (write). Required: `webhook_url`, `confirm`.
- `coronium_delete_webhook` (write). Required: `confirm`.
- `coronium_rotate_webhook_secret` (write). Required: `confirm`.
- `coronium_test_webhook` (write). Required: `confirm`.
- `coronium_get_proxies` (read, directory). Required: none.
- `coronium_get_proxy` (read, directory). Required: `proxy`.
- `coronium_get_proxy_health` (read, directory). Required: none.
- `coronium_test_modem` (write, directory). Required: `proxy`.
- `coronium_replace_modem` (write, directory). Required: `proxy`, `confirm`.
- `coronium_get_openvpn_config` (write, directory). Required: `proxy`.
- `coronium_restart_modem` (write). Required: `proxy`, `confirm`.
- `coronium_rotate_modem` (write, directory). Required: `proxy_identifier`, `confirm`.
- `coronium_get_rotation_status` (read, directory). Required: `proxy`.
- `coronium_set_rotation_interval` (write). Required: `proxy`, `interval_seconds`, `confirm`.
- `coronium_change_proxy_password` (write). Required: `proxy`, `confirm`.
- `coronium_set_modem_metadata` (write). Required: `proxy`, `metadata`.
- `coronium_get_p0f_options` (read). Required: `proxy`.
- `coronium_set_modem_os` (write). Required: `proxy`, `os`, `confirm`.
- `coronium_apply_modem_settings` (write). Required: `proxy`, `confirm`.
- `coronium_preview_modem_cancellation` (read). Required: `proxy`.
- `coronium_cancel_modem` (cancels with refund, needs CORONIUM_ENABLE_SPENDING=1). Required: `proxy`, `min_refund_usd`, `confirm`.
- `coronium_set_white_list` (write). Required: `proxy`, `white_list`, `confirm`.
- `coronium_get_usage` (read). Required: `proxy`.
- `coronium_start_speed_test` (write). Required: `proxy`, `confirm`.
- `coronium_get_speed_test` (read). Required: `proxy`.
- `coronium_revoke_openvpn` (write). Required: `proxy`, `confirm`.
- `coronium_list_countries` (read, directory). Required: none.
- `coronium_list_tariffs` (read, directory). Required: none.
- `coronium_list_free_modems` (read, directory). Required: none.
- `coronium_check_coupon` (read). Required: `code`.
- `coronium_get_renewal_quote` (read, directory). Required: `modems`.
- `coronium_get_payment_status` (read). Required: `payment_id`.
- `coronium_buy_modems_with_balance` (spends money, needs CORONIUM_ENABLE_SPENDING=1). Required: `tariff_id`, `quantity`, `funding_source`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_renew_modems_with_balance` (spends money, needs CORONIUM_ENABLE_SPENDING=1). Required: `modems`, `funding_source`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_list_tickets` (read, directory). Required: none.
- `coronium_get_ticket` (read, directory). Required: `ticket_id`.
- `coronium_create_ticket` (write, directory). Required: `subject`, `message`, `confirm`.
- `coronium_reply_to_ticket` (write, directory). Required: `ticket_id`, `message`, `confirm`.
- `coronium_archive_ticket` (write). Required: `ticket_id`, `confirm`.
- `coronium_list_pool_tariffs` (read). Required: none.
- `coronium_get_pool_stock` (read). Required: none.
- `coronium_get_pool_carriers` (read). Required: `country`.
- `coronium_list_pool_keys` (write). Required: none.
- `coronium_build_pool_proxy_url` (write). Required: `id`.
- `coronium_buy_pool_with_balance` (spends money, needs CORONIUM_ENABLE_SPENDING=1). Required: `tariff_id`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_topup_pool_key` (spends money, needs CORONIUM_ENABLE_SPENDING=1). Required: `id`, `tariff_id`, `expected_total_usd`, `confirm`, `idempotency_key`.
- `coronium_cancel_pool_key` (cancels with refund, needs CORONIUM_ENABLE_SPENDING=1). Required: `id`, `confirm`, `idempotency_key`.
- `coronium_list_pool_sessions` (read). Required: none.
- `coronium_close_pool_session` (write). Required: `confirm`.
- `coronium_list_saved_pool_sessions` (read). Required: none.
- `coronium_save_pool_session` (write). Required: `pool_key_id`, `label`, `params`.
- `coronium_delete_saved_pool_session` (write). Required: `id`, `confirm`.
- `coronium_build_saved_pool_session_url` (write). Required: `id`.
- `coronium_get_capabilities` (read, directory). Required: none.
<!-- /TOOL_CATALOG -->

## Develop and verify

```sh
npm ci
npm run check
npm run docs:check
npm run test:package
```

Tests run against a loopback backend with synthetic credentials and a temporary home directory. `test/fixtures/v3-routes.json` lists the public `/api/v3` routes (method, path, auth and field shapes only), and a test checks that every tool's routes exist in it. No test spends money, rotates a real proxy, sends a ticket or touches production. The optional `npm run test:public` makes four unauthenticated catalog reads against production and is not part of CI.

Publishing uses `.github/workflows/publish.yml` on a `publish-v<version>` tag or a manual run from main, with npm trusted publishing or an `NPM_TOKEN` secret.

## Acceptable use

Coronium proxies are for lawful purposes such as app and website QA, ad verification, localisation testing and monitoring public information. Follow Coronium's Terms (https://www.coronium.io/terms-and-conditions) and the terms of every site you reach through a proxy. Do not use this server or Coronium proxies to create fake or bulk accounts, evade bans or rate limits, bypass security controls, send spam or commit fraud.

## Contact

hello@coronium.io for support and security reports. License: MIT.
