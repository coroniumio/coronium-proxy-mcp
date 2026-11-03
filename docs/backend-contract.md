# API boundary (2.4.2; routes checked 2026-11-03)

This package calls the public Coronium customer API only. The default base is `https://api.coronium.io/api/v3`. Plan, country and stock reads need no token; everything else uses `Authorization: Bearer <token>`. Pool plan discovery reads the public catalog at `/api/v1/tariffs` on the same host and keeps only pool plan fields.

The exact routes the tools call are listed in [`test/fixtures/v3-routes.json`](../test/fixtures/v3-routes.json) (method, path, auth and public field shapes), and every tool declares which of them it uses. The contract test suite fails if a tool names a route that is not in that list.

## Behaviour the tools rely on

- Balances: `GET /account` gives `accountCredit` (USD), `btc.balance` and `usdt.balance`. No combined total is computed.
- Owned proxies: `GET /account/proxies` is ownership-scoped. Proxies with separate HTTP and SOCKS5 logins describe each protocol in `proxyEndpoints.http` and `proxyEndpoints.socks5`; the top-level login fields describe HTTP for those.
- Rotation: `POST /modems/:modem_id/restart` answers `rotated:true`, `rotated:false` (same IP), or HTTP 202 with `pending:true` for rentals that rotate asynchronously. The public `GET /modems/rotate-modem-by-token/:token` answers `{result:"ok", new_ip}` on success. A 429 means the rotation cooldown; its code is not reliable, so the client classifies it by status and `Retry-After` or `retry_after_seconds`.
- Replacement: `POST /modems/:modem_id/replace` issues a new proxy with new credentials and uses one of the daily replacements.
- Cancellation: `POST /modems/:modem_id/cancel` with `dryRun:true` previews the refund without changing anything; without it the proxy is released immediately.
- Purchases and renewals: `/payment/buy-with-account-credit`, `/payment/buy-modems-with-crypto-balance`, `/payment/renew-with-account-credit` and `/payment/renew-modems-with-crypto-balance`, each with an `Idempotency-Key` header. Buys send `tariff_id`, `modemCount`, `max_total_usd` and, for p0f units, `require:["p0f"]`; renewals send `modems:[{modem_id, days}]` and `max_total_usd`. The server refuses a total above `max_total_usd` with HTTP 409 `price_changed` before any debit. Receipts carry `paymentId` (HTTP 200, 202 pending, and 503 `PAYMENT_DELIVERY_UNCONFIRMED`); poll `GET /payments/:id/status` with it. An out-of-stock purchase can be refunded synchronously (HTTP 503 with `refunded:true`).
- Saved-card purchases and renewals: `POST /payment/buy-with-card/:card_id` and `POST /payment/renew-with-card/:card_id` take the same body and `Idempotency-Key` header. `card_id` is a card `_id` from `GET /account/card-list`. HTTP 200 carries the delivered proxies in `data` (no charged amount and no payment ID); 202 and 503 `PAYMENT_DELIVERY_UNCONFIRMED` carry `paymentId`. A card the bank asks to authenticate or declines answers HTTP 402 `CARD_DECLINED` with `error` set to `authentication_required` or the decline code and a readable `message`; nothing was charged.
- Crypto to credit: `POST /account/balance/convert` with `coin` (`usdt`, `btc` or `all`), optional `amount_usd` (single coin) and `dry_run`. A dry run answers `data.preview` and needs no key; a real move needs `Idempotency-Key` (it passes the same idempotency check as the buy routes, so the effective format is 8 to 128 characters of letters, digits, `-` and `_`; any other key, including one with `.` or `:` or longer than 128, answers HTTP 400 "Invalid Idempotency-Key format") and answers `data.moved`, `data.refused`, `account_credit_before` and `account_credit_after`. HTTP 409 `NOTHING_TO_MOVE` means less than $1 can move.
- Account creation: `POST /signup` (public) with `login`, `password`, `name` and optional `purpose` answers `{result:"ok"}` for a new address and for one that already has an account (it never reveals which); a refused email answers HTTP 400 with `error`. `POST /get-token` returns a session `token`. `GET /api/v1/account/api-token` with that session token returns the long-lived API `token` (365 days) and its `expiresAt`. Disposable and reserved email domains are refused at signup; a verification email is sent and nothing waits for it. The new account starts with no balance and no proxies.
- Webhooks: `GET`, `PUT` and `DELETE /account/webhook`, `POST /account/webhook/secret/rotate` and `POST /account/webhook/test`. A webhook URL turns on automatic replacement of dead proxies.
- Tickets: `/tickets` list, create, read, reply and archive. The client removes support-internal fields from results.

## What the client cannot check

- Stock and usage are snapshots. `observed_at` is not a backend measurement time.
- `expected_total_usd` and `min_refund_usd` are checked by this client right before sending. Dedicated-proxy buys and renewals (balance, BTC and saved card) also send the approved total as `max_total_usd`, so the server refuses a higher total; pool purchases, pool top-ups and `min_refund_usd` are checked by this client only. None of these is a price lock.
- Payment-key deduplication and receipt replay live in process memory for 24 hours. After a restart, or on another hosted instance, a repeated key goes through the pre-checks again and the backend's `Idempotency-Key` handling is the guard; reconcile with the preserved key, receipt, payment ledger and owned proxies.
- A listed SOCKS5 URL is not a successful SOCKS5 connection.

## Verification

`npm run check` runs the fixture contract suite and `npm run test:package` installs the packed tarball and starts it over stdio. All state-changing test calls go to a loopback fixture with synthetic credentials.
