# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  [`@coronium/mcp`](https://www.npmjs.com/package/coronium-mcp) (in the
  [coronium-ai](https://github.com/bolivian-peru/coronium-ai) repo). This
  package targets existing customers with email/password; `@coronium/mcp`
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