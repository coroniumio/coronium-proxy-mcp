# Changelog

## 2.0.0 — 2026-09-10

Reconciles the public customer MCP with deployed backend contracts. The Coronium backend, reseller API and private support MCP are unchanged by this release.

### Breaking migration changes

- All 48 previous tool names remain; 11 tools are added. Results use structured `data`/`observed_at` envelopes, with JSON text for compatible clients. Do not parse old human-formatted lines.
- Buy/renew operations require `confirm:true`, an 8–128-character `idempotency_key`, and use `funding_source: account_credit | btc` (default account credit). They send the real backend fields and preserve complete receipts. There are no automatic write retries.
- Renewals use `modems:[{modem_id,days}]`, not a purchase tariff or plain ID list. The new renewal quote must include every requested modem.
- Disruptive modem changes, cancellation, outbound support messages and webhook changes/tests require confirmation. `cancel_modem` means immediate release; the old end-of-term description was wrong. A new cancellation preview performs `dryRun:true`.
- `rotate_modem` waits for the synchronous v3 route. Removed `wait_for_completion`, `max_wait_time` and `CORONIUM_ROTATION_URL`; no external reset service or substring polling. The replacement tool no longer accepts the ignored `same_country` parameter; the backend decides eligibility.
- Rotation intervals are 0 or 60–86400 seconds. Password changes send `proxy_password` explicitly; omission generates a random password locally. OS settings are checked against the modem's actual options.
- Pool top-up requires `tariff_id`; pool tariffs have their own discovery tool. Close-all requires `all_sessions:true` instead of an omitted session key. Saved configurations, carrier stock and supported targeting parameters are exposed. `state` is rejected because the deployed URL builder does not forward it.
- Ticket creation uses `category` and `related_proxies`; the ignored `priority` argument is removed. Listing supports pending/resolved status, limit and offset.
- `set_webhook` requires an explicit URL or null, plus confirmation. Omission no longer disables delivery accidentally.
- Node 20 or newer is required. Dependencies are pinned to the verified release versions.

### Correctness and security

- USD credit comes from `accountCredit`; BTC and USDT remain separate native balances. Missing/failed data is an error. Removed speculative crypto USD totals and `CORONIUM_PRICES_URL`.
- Owned proxy host resolution uses `connection_ip`/`ip_address`, credentials are URL-encoded, IPv6 is bracketed, countries are resolved from the real catalog, and capabilities/rotation tokens are preserved.
- Environment API tokens and the API_KEY alias now work. Quiet dotenv keeps stdout valid JSON-RPC. Logout disables automatic re-login. Optional token persistence uses authenticated encryption and restricted permissions.
- Read-only mode hides writes, including GET routes that initialize wallets or persist usage. It allows pure POST quotes and previews. There are no admin/farmer/credit override tools.
- Ownership is checked before modem operations. HTTP 200 error bodies, rotated:false, malformed responses and ambiguous write failures are not reported as success. Error details retain reconciliation information while redacting credential fields.
- A payment key is bound to one request within a process; concurrent identical calls share the result. Both successes and failures are retained for reconciliation. This does not promise exactly-once execution across process restarts.
- Added guide resource, discovery/diagnosis prompts, capability information, MCP annotations, contract tests, package smoke test and CI.

## Historical releases

The entries below describe earlier versions; use the 2.0 migration notes for current behavior.

## [1.3.0] - 2026-05-27

### Added (14 tools → 48 total) — covering v3 endpoints shipped since 1.2.4

- **Pool Gateway (pay-per-GB, Proxies.sx)** — `coronium_get_pool_stock`, `coronium_list_pool_keys`, `coronium_build_pool_proxy_url`, `coronium_topup_pool_key`, `coronium_cancel_pool_key`, `coronium_buy_pool_with_balance`, `coronium_list_pool_sessions`, `coronium_close_pool_session`. Return a clear error when the pool tier is disabled (503).
- **`coronium_get_proxy_health`** — `GET /account/proxies/health`; per-modem liveness so agents stop retrying dead proxies.
- **`coronium_get_payments`** — `GET /account/payments`; full payment + invoice ledger (reconciliation / duplicate detection).
- **`coronium_get_p0f_options`** — `GET /modems/{id}/p0f-options`; discover valid OS values for `coronium_set_modem_os`.
- **`coronium_apply_modem_settings`** — `POST /modems/{id}/apply-settings`.
- **`coronium_get_webhook` / `coronium_set_webhook`** — `GET`/`PUT /account/webhook`; modem-lifecycle auto-swap webhook.

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
  them — both tools returned 302 redirects). Now reachable on the
  canonical base URL. Added to the OpenAPI spec at
  https://dashboard.coronium.io/api-docs/.

## [1.2.3] - 2026-04-30

### Fixed
- 🐛 `coronium_list_tickets` now correctly unwraps the `{data: {tickets: [...]}}`
  response shape (was returning empty list even when tickets existed).
  Caught during a live MCP-layer sync verification.

## [1.2.2] - 2026-04-30

### Added
- 🤖 **Decision guide for AI agents** in README — concrete heuristics for
  rotate vs replace, stock-out handling, balance interpretation, rotation
  intervals by use case, ticket-vs-retry, country/carrier selection.
  Helps Claude/Cursor/Windsurf pick the right tool semantically rather
  than by name match.

### Changed
- ✏️ Removed phrasing that mischaracterised the production API as
  "legacy" — `https://api.coronium.io/api/v3` is Coronium's main
  production API, serving both the customer dashboard and agent-native
  integrations.

## [1.2.1] - 2026-04-30

### Added
- 📦 Published to npm as `coronium-proxy-mcp` — install via
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
- 🛒 **Full purchase + lifecycle surface** — buy, renew, cancel, replace, test, openvpn
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
  production API for everything — proxies, payments, tickets, account.
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