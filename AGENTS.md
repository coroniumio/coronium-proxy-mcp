# Public MCP maintenance

This repository is the public customer MCP. Work here does not authorize changes to the Coronium backend, reseller API, private OpenClaw support MCP, customer balances, farmer servers or customer modem assignments.

Use the deployed route/controller contract as evidence for field names and side effects; see docs/backend-contract.md. Keep fixes readable and scoped, following https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md.

Never use production payment, rotation, cancellation, replacement, credential or support-message calls for verification. Contract tests must use loopback fixtures, synthetic credentials and an isolated home directory. Only the explicitly named public catalog smoke script may make unauthenticated production reads.

Preserve structured receipts, native currencies, unknown states, ownership checks, confirmations and idempotency keys. No automatic write retries, alternate-route retries, amount splitting or bypasses of backend refusal. Immediate cancellation must never be described as disabling auto-renew.

Do not expose admin/server/daemon repair routes or alter shared/private hardware or another seller's ports. Capability and connectivity claims must be specific to the modem, provider and tested protocol.

Keep all existing tool names unless a deliberate major migration documents their removal. Regenerate docs/tool-catalog.json and the README catalog when schemas change. Run npm run check, npm run docs:check and npm run test:package before release. Never commit credentials, token caches, private customer evidence or environment files.
