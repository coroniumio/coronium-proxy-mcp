# Changelog

## 2.2.1 - 2026-10-29

Money-path fixes. The tool list and profile counts are unchanged (directory 21, buyer 12 or 13 with spending on, read-only 31, full 59 or 65 with spending on).

### Changed

- `coronium_buy_modems_with_balance` and `coronium_renew_modems_with_balance` send the approved `expected_total_usd` to the server as `max_total_usd`, so the server itself refuses a higher total (HTTP 409 `price_changed`, nothing charged). The client-side check before sending stays. The `idempotency_key` is sent as the `Idempotency-Key` header, as before.
- A server `price_changed` refusal carries a recovery hint: nothing was charged, quote again, ask again, and use a new `idempotency_key` for the newly approved total. `details.quote` holds the server's current figure.
- Buy and renew results now carry `payment_id`, `pending` (true on HTTP 202) and `next_step`, which tells the agent to poll `coronium_get_payment_status` with that ID and never buy again. A 503 `payment_delivery_unconfirmed` error carries `payment_id` and the same poll hint. Receipts also record `request.http_status`.
- `require: ["p0f"]` is the way to ask for units with TCP fingerprint (p0f) control on a buy; `want_p0f: true` still works as a deprecated alias and is sent as `require: ["p0f"]`. `coronium_quote_purchase` accepts `require` too. Both refuse with `p0f_unavailable` before any charge when the plan's p0f count is below the quantity, and quote plans show `p0f_available`.
- Plan names from the API lose leading and trailing whitespace (some end in tabs) in `coronium_quote_purchase` and `coronium_list_tariffs`.
- The agent guide (`coronium://guide`) no longer says purchase receipts carry no payment ID.
- README and llms.txt explain why `coronium_get_crypto_balance` is marked as a write (the backend can create a missing deposit wallet on that call) and that USDT is not a payment lane in this MCP.
- The Claude Code plugin pins `coronium-proxy-mcp@2.2.1` (plugin 1.0.2). Its tool list is unchanged.

## 2.2.0 - 2026-10-29

Hygiene release: token-only sign-in by default, a short `buyer` profile, a purchase quote tool, recovery hints on every error, and a stricter price check before any spend.

### Migration from 2.1.0

- **`coronium_login` and `coronium_logout` are hidden by default.** They are registered only with `CORONIUM_ENABLE_LOGIN_TOOL=1`, in the `full` and `read-only` profiles, never in `directory` or `buyer`. Use `CORONIUM_API_TOKEN`. `CORONIUM_LOGIN` and `CORONIUM_PASSWORD` in the host environment still work for automatic login.
- **`expected_total_usd` must match.** Buy, renew, pool buy and top-up now refuse with `price_changed` when the live total differs from the approved one in either direction (2.1.0 refused only when it was higher). Quote, show, approve, then pass the quoted number.
- **Tool order is alphabetical.** `tools/list` no longer follows module order.
- **Error details moved to the text content.** Failed calls still set `isError:true`; the `{error}` object is now only in the JSON text, not in `structuredContent`, because clients that check `structuredContent` against the output schema rejected it. Parse `content[0].text`.

### Added

- `buyer` profile (`CORONIUM_TOOL_PROFILE=buyer`): 13 tools for buying and running dedicated proxies. Plans, stock, quote, buy (only with `CORONIUM_ENABLE_SPENDING=1`), payment status, owned proxies, test, rotate and rotation status, replace, balance, crypto balance and capabilities.
- `coronium_quote_purchase`: the exact USD total for a plan and quantity, with stock checked and an optional coupon applied. Spends nothing. Its `total_usd` is the `expected_total_usd` for the buy.
- `recovery_hint` on every error: one sentence on what to do next. Out-of-stock errors list up to five plans that are in stock now.
- `server.json` and `mcpName` (`io.github.coroniumio/coronium-proxy-mcp`) for the MCP Registry, plus a workflow that publishes it with GitHub OIDC.
- `get_capabilities` reports `login_tool_enabled` and `auth`.
- Tool titles are now written as words with a capital letter.

### Changed

- The agent guide (`coronium://guide`) explains the quote, approve, buy, poll order and how funding works today: account credit added in the dashboard, or BTC sent to the account's deposit address.
- The Claude Code plugin pins `coronium-proxy-mcp@2.2.0` (plugin 1.0.1). Its tool list is unchanged.

## 2.1.0 - 2026-10-17

Directory-ready release: explicit tool profiles, spending off by default, and fixes for rotation, SOCKS5 URLs, error codes, webhooks and tickets against the live customer API.

### Migration from 1.3.0 (and the unpublished 2.0.0)

1.3.0 users get every 2.0.0 change below as well; read the 2.0.0 section too. All 1.3.0 tool names still exist, but several now need new arguments or a setting.

- **Spending is off by default.** `buy_modems_with_balance`, `renew_modems_with_balance`, `buy_pool_with_balance`, `topup_pool_key`, `cancel_modem` and `cancel_pool_key` are registered only with `CORONIUM_TOOL_PROFILE=full` (the default) and `CORONIUM_ENABLE_SPENDING=1`. Without both, the HTTP client also refuses money calls (`spending_disabled`). If you buy through this MCP today, add `CORONIUM_ENABLE_SPENDING=1`.
- **Approved amounts are required.** Buy, renew, pool buy and top-up need `expected_total_usd`; the tool re-reads the price and refuses with `price_changed` when the total is higher. `cancel_modem` needs `min_refund_usd` and refuses with `refund_changed` when the fresh refund is lower. `funding_source` no longer defaults to `account_credit`; pass it explicitly.
- **New `CORONIUM_TOOL_PROFILE`**: `directory` (21-tool allowlist, no money, login, OS fingerprint or wallet-creating tools, `check_token` without a token argument), `full` (default) and `read-only`. `CORONIUM_READ_ONLY=true` still works as an alias for `read-only`. An unknown profile value stops startup.
- **Rotation results changed shape.** `restart_modem` and `rotate_modem` return `{state, ip, ...}` with `state` `done`, `rotating` or `unchanged` instead of the raw backend body. `rotated:false` is now `state:"unchanged"` (not an error). HTTP 202 pending rotations are `rotating` (they were reported as failures). A token rotation success without a `rotated` field is `done` (it was reported as a failure).
- **Error codes are lowercase.** `PAYMENT_IN_PROGRESS` becomes `payment_in_progress`; the original is kept in `backend_code`. Every 429 on a rotation route is `rotation_cooldown` with `retry_after_seconds` (also parsed from the message when the header is missing). Other 429s without a useful code are `rate_limited`. A 5xx token rotation failure is `rotation_failed`. A synchronously refunded purchase has `outcome:"refunded_not_charged"`.
- **Diagnostics return results, not errors.** `test_modem` and `test_webhook` return `ok:true` or `ok:false` with the backend's reason.
- `get_openvpn_config`, `test_modem` and `get_crypto_balance` are treated as writes (hidden in `read-only`): some OpenVPN profiles download once or issue a new certificate per call.
- `coronium_login` accepts account names that are not email addresses.

### Added

- `coronium_delete_webhook` and `coronium_rotate_webhook_secret` (the new secret is shown once).
- Coronium Node tools (full profile): `coronium_set_white_list`, `coronium_get_usage`, `coronium_start_speed_test`, `coronium_get_speed_test`, `coronium_revoke_openvpn`.
- `list_free_modems` accepts `carrier_id`.
- `test/fixtures/v3-routes.json`: the public `/api/v3` route list (method, path, auth, field shapes). Every tool declares its routes and a test checks them against this fixture.
- Purchase results include `delivery` (`requested_count`, `delivered_count`, `delivery_verified`) and reconciliation guidance, because receipts carry no payment ID.

### Fixed

- `socks5_url` uses the SOCKS5 login for proxies with separate HTTP and SOCKS5 credentials (it used the HTTP login).
- `set_webhook` now states that a URL turns on automatic replacement of dead proxies.
- Ticket results no longer include support-internal fields.
- Renewal quotes are refused when the backend changed the days of a line. A coupon that gives no discount is refused before checkout instead of being charged at full price.
- Concurrent cancel or replace calls for the same proxy send one request.
- Money tools are annotated `destructiveHint:true`; every tool has an annotation `title`.
- `CORONIUM_ENABLE_SPENDING` and `CORONIUM_BASE_URL` are no longer read from a `.env` file in the working directory; set them in the host environment or via `DOTENV_CONFIG_PATH`.
- Cancellation results and previews return only the documented customer fields.
- Buy and renew results include `charge` (`approved_usd`, `charged_usd`, `within_approval`) from the backend's charged amount.
- `change_proxy_password` describes the real length rule (6-128, Node rentals 8 or more).
- Dev dependencies and CI actions are pinned to exact versions.

### Dependencies

- `@modelcontextprotocol/sdk` pinned to 1.32.1 (fixes GHSA-6qxp-vccf-f47h); transitive advisories resolved. `npm audit` reports no known vulnerabilities.

## 2.0.0 - 2026-09-10

Reconciles the public customer MCP with deployed backend contracts. The Coronium backend, reseller API and private support MCP are unchanged by this release.

### Breaking migration changes

- All 48 previous tool names remain; 11 tools are added. Results use structured `data`/`observed_at` envelopes, with JSON text for compatible clients. Do not parse old human-formatted lines.
- Buy/renew operations require `confirm:true`, an 8-128-character `idempotency_key`, and use `funding_source` `account_credit` or `btc` (default account credit). They send the real backend fields and preserve complete receipts. There are no automatic write retries.
- Renewals use `modems:[{modem_id,days}]`, not a purchase tariff or plain ID list. The new renewal quote must include every requested modem.
- Disruptive modem changes, cancellation, outbound support messages and webhook changes/tests require confirmation. `cancel_modem` means immediate release; the old end-of-term description was wrong. A new cancellation preview performs `dryRun:true`.
- `rotate_modem` waits for the synchronous v3 route. Removed `wait_for_completion`, `max_wait_time` and `CORONIUM_ROTATION_URL`; no external reset service or substring polling. The replacement tool no longer accepts the ignored `same_country` parameter; the backend decides eligibility.
- Rotation intervals are 0 or 60-86400 seconds. Password changes send `proxy_password` explicitly; omission generates a random password locally. OS settings are checked against the modem's actual options.
- Pool top-up requires `tariff_id`; pool tariffs have their own discovery tool. Close-all requires `all_sessions:true` instead of an omitted session key. Saved configurations, carrier stock and supported targeting parameters are exposed. `state` is rejected because the deployed URL builder does not forward it.
- Ticket creation uses `category` and `related_proxies`; the ignored `priority` argument is removed. Listing supports pending/resolved status, limit and offset.
- `set_webhook` requires an explicit URL or null, plus confirmation. Omission no longer disables delivery accidentally.
- Node 20 or newer is required. Dependencies are pinned to the verified release versions.

### Correctness and security

- USD credit comes from `accountCredit`; BTC and USDT remain separate native balances. Missing/failed data is an error. Removed speculative crypto USD totals and `CORONIUM_PRICES_URL`.
- Owned proxy host resolution uses `connection_ip`/`ip_address`, credentials are URL-encoded, IPv6 is bracketed, countries are resolved from the real catalog, and capabilities/rotation tokens are preserved.
- Environment API tokens and the API_KEY alias now work. Quiet dotenv keeps stdout valid JSON-RPC. Logout disables automatic re-login. Optional token persistence uses authenticated encryption and restricted permissions.
- Read-only mode hides writes, including GET routes that initialize wallets or persist usage. It allows pure POST quotes and previews. There are no admin or credit override tools.
- Ownership is checked before modem operations. HTTP 200 error bodies, rotated:false, malformed responses and ambiguous write failures are not reported as success. Error details retain reconciliation information while redacting credential fields.
- A payment key is bound to one request within a process; concurrent identical calls share the result. Both successes and failures are retained for reconciliation. This does not promise exactly-once execution across process restarts.
- Added guide resource, discovery/diagnosis prompts, capability information, MCP annotations, contract tests, package smoke test and CI.

## Historical releases

The entries below describe earlier versions; use the 2.0 migration notes for current behavior.

## [1.3.0] - 2026-05-27

### Added (14 tools → 48 total) - covering v3 endpoints shipped since 1.2.4

- **Pool Gateway (pay-per-GB, Proxies.sx)** - `coronium_get_pool_stock`, `coronium_list_pool_keys`, `coronium_build_pool_proxy_url`, `coronium_topup_pool_key`, `coronium_cancel_pool_key`, `coronium_buy_pool_with_balance`, `coronium_list_pool_sessions`, `coronium_close_pool_session`. Return a clear error when the pool tier is disabled (503).
- **`coronium_get_proxy_health`** - `GET /account/proxies/health`; per-modem liveness so agents stop retrying dead proxies.
- **`coronium_get_payments`** - `GET /account/payments`; full payment + invoice ledger (reconciliation / duplicate detection).
- **`coronium_get_p0f_options`** - `GET /modems/{id}/p0f-options`; discover valid OS values for `coronium_set_modem_os`.
- **`coronium_apply_modem_settings`** - `POST /modems/{id}/apply-settings`.
- **`coronium_get_webhook` / `coronium_set_webhook`** - `GET`/`PUT /account/webhook`; modem-lifecycle auto-swap webhook.

### Changed

- `coronium_list_tariffs` now surfaces the additive `ip_stack:{ipv4,ipv6,native_ipv6}` field from `/tariffs/available`.

## [1.2.4] - 2026-04-30

### Fixed
- 🐛 `coronium_set_low_balance_threshold` now correctly enforces the
  backend's allowed-values constraint (`100`, `300`, `500` USD only).
  Previous schema accepted any non-negative number; backend rejected
  values like `200` with a `400` and the MCP surfaced an opaque error.
  Schema now uses `z.union([z.literal(100), z.literal(300), z.literal(500)])`
  so the agent gets the constraint at tool-call time, not after a round-trip.
- 🌐 `/account/low-balance-threshold` GET + PUT mounted on `/api/v3`
  (previously only on `/api/v1`, so the v3-defaulted MCP couldn't reach
  them - both tools returned 302 redirects). Now reachable on the
  canonical base URL. Added to the OpenAPI spec at
  https://dashboard.coronium.io/api-docs/.

## [1.2.3] - 2026-04-30

### Fixed
- 🐛 `coronium_list_tickets` now correctly unwraps the `{data: {tickets: [...]}}`
  response shape (was returning empty list even when tickets existed).
  Caught during a live MCP-layer sync verification.

## [1.2.2] - 2026-04-30

### Added
- 🤖 **Decision guide for AI agents** in README - concrete heuristics for
  rotate vs replace, stock-out handling, balance interpretation, rotation
  intervals by use case, ticket-vs-retry, country/carrier selection.
  Helps Claude/Cursor/Windsurf pick the right tool semantically rather
  than by name match.

### Changed
- ✏️ Removed phrasing that mischaracterised the production API as
  "legacy" - `https://api.coronium.io/api/v3` is Coronium's main
  production API, serving both the customer dashboard and agent-native
  integrations.

## [1.2.1] - 2026-04-30

### Added
- 📦 Published to npm as `coronium-proxy-mcp` - install via
  `claude mcp add coronium-proxy npx -y coronium-proxy-mcp` instead of
  cloning + building.
- 🔀 Top-of-README "Which Coronium MCP do I want?" table cross-linking
  to [`coronium-cli` + `coronium-mcp`](https://github.com/bolivian-peru/coronium-ai)
  for new users without an existing dashboard account.

### Fixed
- 🐛 Renamed bin from `coronium-mcp` → `coronium-proxy-mcp` to avoid
  global-install collision with the wallet-bound `coronium-mcp` package.
  Affects only `npm install -g`; `claude mcp add npx -y …` flow is
  unchanged.

## [1.2.0] - 2026-04-30

Major feature release. Tool surface grew from 6 → 34, backend audited
end-to-end against current production API, codebase modularised.

### Added
- 🛒 **Full purchase + lifecycle surface** - buy, renew, cancel, replace, test, openvpn
  - `coronium_list_countries`, `coronium_list_tariffs`, `coronium_list_free_modems`
  - `coronium_check_coupon`, `coronium_buy_modems_with_balance`, `coronium_renew_modems_with_balance`
  - `coronium_get_payment_status`
  - `coronium_replace_modem` (swap dead modems for working ones; same-country guard)
  - `coronium_test_modem` (live connectivity probe)
  - `coronium_cancel_modem`, `coronium_get_openvpn_config`
- 🔄 **Rotation control suite**
  - `coronium_restart_modem` (authenticated, hits `/v3/modems/:id/restart`)
  - `coronium_get_rotation_status` (poll real-time rotation state)
  - `coronium_set_rotation_interval` (configure auto-rotate cadence in seconds)
  - `coronium_change_proxy_password`
- 🎯 **Modem configuration**
  - `coronium_set_modem_metadata` (free-form labels)
  - `coronium_set_modem_os` (p0f Android/iOS/Windows fingerprint preset)
- 📧 **Low-balance alert tiers** (matches the `/v1/account/low-balance-threshold`
  endpoint shipped on the backend 2026-04-30)
  - `coronium_get_low_balance_threshold`
  - `coronium_set_low_balance_threshold`
- 🎫 **Support tickets**
  - `coronium_list_tickets`, `coronium_get_ticket`, `coronium_create_ticket`
  - `coronium_reply_to_ticket`, `coronium_archive_ticket`
- 💵 **Live coin pricing** for crypto-balance USD valuation
  - CoinGecko free tier with 60s in-memory cache
  - Falls back to last-cached values then static defaults if rate-limited
- 🏠 **Account profile + unified balance view**
  - `coronium_get_account` (profile, role, business data, 2FA state)
  - `coronium_get_balance` (account_credit + crypto, all in USD with live prices)

### Changed
- 🧱 **Modularised**: single 2010-line `server.ts` → `src/{config,logger,token-store,api-client,prices,formatters}.ts` + `src/tools/{auth,account,proxies,shop,tickets}.ts`
- 🔁 **Auto-login on 401**: when `CORONIUM_LOGIN`/`CORONIUM_PASSWORD` are set,
  any tool that gets a 401 transparently re-mints the token and retries once.
  Agents no longer need to handle expiry manually.
- 🌐 **Single base URL**: `https://api.coronium.io/api/v3` is the canonical
  production API for everything - proxies, payments, tickets, account.
  Configurable via `CORONIUM_BASE_URL` if you're hitting a tenant or
  staging deployment.
- 📜 **Cleaner errors**: 401/402/403/404/422/429/5xx mapped to readable
  messages with the failing route in the prefix.
- ✅ Version string in code now matches `package.json`.

### Fixed
- 🐛 Hardcoded coin prices replaced with live fetcher.
- 🐛 Token expiry no longer requires manual `coronium_get_token` re-call.
- 🐛 `coronium_get_proxies` filtering now consistent across `country_code`,
  `online_only`, `expiring_within_days`.

### Compatibility
- All 6 v1.x tool names retained (`coronium_get_token` / `coronium_check_token` /
  `coronium_get_proxies` / `coronium_get_crypto_balance` / `coronium_get_credit_cards` /
  `coronium_rotate_modem`). Agents written against 1.1.x continue to work.
- New `coronium_login` is a friendlier alias for the established
  `coronium_get_token` flow; both are present.

### Sibling project
- Wallet-bound + voucher-gated MCP for new agent-native signups lives at
  [`coronium-mcp`](https://www.npmjs.com/package/coronium-mcp) (in the
  [coronium-ai](https://github.com/bolivian-peru/coronium-ai) repo). This
  package targets existing customers with email/password; `coronium-mcp`
  targets new wallet-onboarded users. Tool surfaces overlap intentionally
  so an agent can substitute either.

## [1.1.2] - 2025-11-23

### Added
- ✅ **Real-time status verification**: Proxies now show accurate online/offline status
  - Checks actual modem state from rotation service, not cached API data
  - Adds "(verified)" label when real-time check succeeds
  - Prevents confusion from stale API status
- 🔗 **Rotation URLs**: Display direct links for modem restart and status checking
  - Restart URL for manual modem rotation
  - Status URL for real-time modem status checks
  - Rotation token included for API integration

### Security
- 🔒 **Domain hiding**: Rotation service domain is now hidden in output for security
  - URLs display as `https://[rotation-service]/...` instead of revealing actual domain
  - Prevents exposure of internal rotation infrastructure
- 🧹 **Simplified configuration**: Removed optional environment variables
  - Removed `TOKEN_ENCRYPTION_KEY` (auto-generated by default)
  - Removed `LOG_LEVEL` (sensible default provided)
  - Reduces user confusion and setup complexity

### Changed
- 📚 **Enhanced documentation**: Updated README with new output format examples
- 🔄 **Improved proxy display**: Better formatting with rotation tokens and URLs
- 📝 **Cleaner .env.example**: Simplified to only required credentials

### Fixed
- 🐛 **Status accuracy**: Fixed issue where modems showed offline despite being functional
  - API's cached status could be stale after rotation
  - Now validates with real-time external check
  - Customers see correct modem state immediately

## [1.1.1] - 2025-11-23

### Security
- 🔒 Enhanced .gitignore to prevent sensitive data commits
  - Added patterns for test scripts and temporary files
  - Ensured .env and .mcp.json are properly ignored
  - Added backup file patterns (*.save, *.backup, *.bak)
- 🛡️ Removed test scripts from production codebase
- 🔐 Improved credential isolation and security practices

### Changed
- 📚 Updated README with enhanced feature descriptions
- 📝 Expanded documentation for better clarity
- 🧹 Cleaned up repository structure for production deployment
- ✨ Improved changelog format and detail level

### Fixed
- 🐛 Ensured all backlinks to coronium.io remain intact
- 📋 Verified all documentation links are working correctly

## [1.1.0] - 2025-11-14

### Added
- 🔄 **IP Rotation Feature**: New `coronium_rotate_modem` tool for rotating proxy IPs
  - Rotate by country code (US, UA, etc.)
  - Rotate by proxy name or ID
  - Rotate by dongle ID (partial match supported)
  - Rotate all proxies simultaneously
  - Rotation history tracking in ~/.coronium/rotation_history.json
- 📊 Enhanced proxy status verification with multiple fallback methods
- ⏱️ Improved rotation timing with smart retry logic
- 🔍 Better proxy identification system with exact and partial matching

### Fixed
- 🐛 Fixed critical bug where "US" rotation incorrectly selected Ukraine (UA) proxy
- 🔧 Improved country code matching to ensure exact matches only
- 📝 Enhanced error messages for ambiguous proxy selections

### Changed
- 📚 Expanded README documentation with detailed usage examples
- 🔒 Improved security with better credential handling
- 📦 Updated package.json with correct repository URLs
- 🛠️ Enhanced logging throughout the rotation process

### Security
- Added .env.example for secure configuration
- Removed any hardcoded credentials from source code
- Enhanced .gitignore to prevent credential leaks

## [1.0.0] - 2025-11-10

### Initial Release
- 🔐 Secure authentication with Coronium.io API
- 📡 List all mobile proxies with connection details
- 💰 Check cryptocurrency balances (BTC/USDT)
- 💳 View saved payment methods
- 🔒 AES-256-CBC encryption for token storage
- 📦 Full MCP (Model Context Protocol) compatibility
- 🤖 Support for Claude Desktop, Cursor, Cline, VS Code, and other MCP tools

### Features
- Automatic token management with 30-day persistence
- Detailed proxy information including HTTP/SOCKS5 connection strings
- Crypto deposit addresses for account funding
- Comprehensive error handling and logging
- TypeScript implementation for type safety