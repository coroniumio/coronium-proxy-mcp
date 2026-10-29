# Public MCP maintenance

This repository is the public customer MCP. Work here does not authorize changes to the Coronium backend, reseller API, private OpenClaw support MCP, customer balances, proxy servers or customer proxy assignments.

Use the deployed route/controller contract as evidence for field names and side effects; see docs/backend-contract.md. Keep fixes readable and scoped, following https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md.

Never use production payment, rotation, cancellation, replacement, credential or support-message calls for verification. Contract tests must use loopback fixtures, synthetic credentials and an isolated home directory. Only the explicitly named public catalog smoke script may make unauthenticated production reads.

Preserve structured receipts, native currencies, unknown states, ownership checks, confirmations and idempotency keys. No automatic write retries, alternate-route retries, amount splitting or bypasses of backend refusal. Immediate cancellation must never be described as disabling auto-renew.

Do not expose admin or server repair routes. Capability and connectivity claims must be specific to the modem, provider and tested protocol.

Keep all existing tool names unless a deliberate major migration documents their removal. Regenerate docs/tool-catalog.json and the README catalog when schemas change. Run npm run check, npm run docs:check and npm run test:package before release. Never commit credentials, token caches, private customer evidence or environment files.

Profiles: the directory profile is the explicit DIRECTORY_TOOLS allowlist in src/profiles.ts plus test/profiles/directory.json; change both on purpose. The buyer profile is the explicit BUYER_TOOLS allowlist plus test/profiles/buyer.json and buyer-spending.json. Spending tools must stay behind CORONIUM_ENABLE_SPENDING=1 with the full or buyer profile, and need confirm:true, an idempotency key and an expected_total_usd that matches the live price. coronium_login and coronium_logout stay behind CORONIUM_ENABLE_LOGIN_TOOL=1 and never enter directory or buyer. Tools register in alphabetical order. Every error carries a recovery_hint. Tool descriptions describe only funding lanes that exist today; the way to try the service is a paid 1-day plan. Every tool declares its backend routes; they must exist in test/fixtures/v3-routes.json.

Public repository: never add internal implementation details (backend file paths, server names, hosts, database names, credentials, defect descriptions or revenue terms). The route fixture holds only method, path, auth and public field shapes. Copy uses a short dash, never long dashes. Contact address: hello@coronium.io.
