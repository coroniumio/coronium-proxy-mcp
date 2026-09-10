# Release verification — 2026-09-10

Source implementation: [897fe5b](https://github.com/coroniumio/coronium-proxy-mcp/commit/897fe5b2a8b23f4fabb72f8d8786e042c89f6b72), version 2.0.0, pushed to main and tagged `publish-v2.0.0`.

- 59 tools: all 48 previous names retained, 11 added.
- 65 contract tests passed on Node 20, 22 and 24.
- Clean tarball installation and real stdio startup/balance contract passed on each Node version.
- Generated tool documentation matches runtime schemas.
- Production dependency audit reported zero known vulnerabilities at verification time.
- Four unauthenticated public catalog checks passed: 26 countries, 31 available modem plans, 15 aggregate stock rows and 3 pool plans. These are snapshots, not inventory guarantees.
- No real payment, customer modem action, ticket message, webhook test, backend deployment, reseller API change or farmer/server operation was performed.

[Main-branch CI](https://github.com/coroniumio/coronium-proxy-mcp/actions/runs/34468738993) passed. The [npm release workflow](https://github.com/coroniumio/coronium-proxy-mcp/actions/runs/34468744175) passed all checks but publication failed with **ENEEDAUTH**. A subsequent npm registry query still reported **1.3.0**. This record describes that attempt, not future registry state.

## Complete npm publication

An npm package owner must configure either:

- Trusted publishing for organization `coroniumio`, repository `coronium-proxy-mcp`, workflow filename `publish.yml`, with direct publishing allowed; or
- A valid publishing credential in the GitHub repository's `NPM_TOKEN` Actions secret, subject to npm's current account/2FA requirements.

Then run `publish-npm` manually on main, or rerun the failed tag workflow. Do not create a different package name or bypass publisher authorization. Verify `npm view coronium-proxy-mcp@2.0.0 version` afterward. Until npm publication succeeds, use the GitHub checkout installation in the README.
