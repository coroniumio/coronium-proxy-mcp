# API boundary (2.2.0; routes checked 2026-10-17)

This package calls the public Coronium customer API only. The default base is `https://api.coronium.io/api/v3`. Plan, country and stock reads need no token; everything else uses `Authorization: Bearer <token>`. Pool plan discovery reads the public catalog at `/api/v1/tariffs` on the same host and keeps only pool plan fields.

The exact routes the tools call are listed in [`test/fixtures/v3-routes.json`](../test/fixtures/v3-routes.json) (method, path, auth and public field shapes), and every tool declares which of them it uses. The contract test suite fails if a tool names a route that is not in that list.

## Behaviour the tools rely on

- Balances: `GET /account` gives `accountCredit` (USD), `btc.balance` and `usdt.balance`. No combined total is computed.
- Owned proxies: `GET /account/proxies` is ownership-scoped. Proxies with separate HTTP and SOCKS5 logins describe each protocol in `proxyEndpoints.http` and `proxyEndpoints.socks5`; the top-level login fields describe HTTP for those.
- Rotation: `POST /modems/:modem_id/restart` answers `rotated:true`, `rotated:false` (same IP), or HTTP 202 with `pending:true` for rentals that rotate asynchronously. The public `GET /modems/rotate-modem-by-token/:token` answers `{result:"ok", new_ip}` on success. A 429 means the rotation cooldown; its code is not reliable, so the client classifies it by status and `Retry-After` or `retry_after_seconds`.
- Replacement: `POST /modems/:modem_id/replace` issues a new proxy with new credentials and uses one of the daily replacements.
- Cancellation: `POST /modems/:modem_id/cancel` with `dryRun:true` previews the refund without changing anything; without it the proxy is released immediately.
- Purchases and renewals: `/payment/buy-with-account-credit`, `/payment/buy-modems-with-crypto-balance`, `/payment/renew-with-account-credit` and `/payment/renew-modems-with-crypto-balance`, each with an `Idempotency-Key` header. Buys send `tariff_id` and `modemCount`; renewals send `modems:[{modem_id, days}]`. Receipts carry no payment ID. An out-of-stock purchase can be refunded synchronously (HTTP 503 with `refunded:true`).
- Webhooks: `GET`, `PUT` and `DELETE /account/webhook`, `POST /account/webhook/secret/rotate` and `POST /account/webhook/test`. A webhook URL turns on automatic replacement of dead proxies.
- Tickets: `/tickets` list, create, read, reply and archive. The client removes support-internal fields from results.

## What the client cannot check

- Stock and usage are snapshots. `observed_at` is not a backend measurement time.
- `expected_total_usd` and `min_refund_usd` are checked by this client right before sending. The server does not receive the approved amount, so they are not a server price lock.
- Payment-key deduplication lives in process memory. After a restart, reconcile with the preserved key, receipt, payment ledger and owned proxies.
- A listed SOCKS5 URL is not a successful SOCKS5 connection.

## Verification

`npm run check` runs the fixture contract suite and `npm run test:package` installs the packed tarball and starts it over stdio. All state-changing test calls go to a loopback fixture with synthetic credentials.
