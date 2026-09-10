# Backend contract alignment — 2026-09-10

This release changes only `coroniumio/coronium-proxy-mcp`. The implementation was compared with deployed Coronium v3 route/controller code, the public OpenAPI document and the published 1.3.0 package. Authenticated lifecycle/payment tests use synthetic loopback fixtures, not production customers. Public catalog reads can additionally be checked without authentication. This is contract verification, not a claim that real purchases, rotations or every farmer's SOCKS5 connection were exercised.

## API boundary

The default base is `https://api.coronium.io/api/v3`. Public country, tariff and free-stock reads need no Bearer token. Pool stock/carrier routes are under the authenticated v3 router and do need it. Pool tariff discovery uses the existing, unauthenticated `https://api.coronium.io/api/v1/tariffs` catalog on the same configured origin and projects only pool plan fields. No backend endpoint was added or changed.

| Concern | Verified contract / MCP behavior |
| --- | --- |
| Account balance | `GET /account`: `accountCredit`, `btc.balance`, `usdt.balance`; no synthetic total |
| Deposit addresses | `GET /account/crypto-balance` can initialize wallets; classified as write |
| Owned modems | `GET /account/proxies`: ownership-scoped; `connection_ip`, `ip_address`, `restartToken`, `features` |
| Available modem tariffs | `GET /tariffs/available`: `data`, `_cached`, optional `_ageMs`; stock is shared between plans |
| Credit purchase | `POST /payment/buy-with-account-credit`: `tariff_id`, `modemCount`, optional metadata/coupon/wantP0f |
| BTC purchase | `POST /payment/buy-modems-with-crypto-balance`; crypto lane settles in BTC |
| Credit / BTC renewal | `POST /payment/renew-with-account-credit` or `/payment/renew-modems-with-crypto-balance`: `modems:[{modem_id,days}]`, optional coupon; omit tariff_id |
| Renewal quote | `POST /payment/renewal-quote`; pure read; reject incomplete `line_items` |
| Coupon | `POST /coupons/check`: `coupon_name`; pure read |
| Rotation | Authenticated `POST /modems/:id/restart`: `rotated:true/false`; status state is `idle/rotating/done/failed` |
| Rotation token | Mutating `GET /modems/rotate-modem-by-token/:token`; no API token or separate reset service needed |
| Password | `PUT /modems/:id/change-password`: explicit `proxy_password`, at least 6 characters |
| Metadata / interval | `PUT /modems/:id/set-metadata`: string; `/set-rotation-interval`: `rotation_interval` of 0 or >=60 |
| OS support | `GET /modems/:id/p0f-options`: supported, options, current and cooldown; per-server/provider support |
| Cancellation | `POST /modems/:id/cancel`: immediate release/refund policy; `dryRun:true` is a pure preview |
| Pool usage | `GET /account/pool-keys`: cap/used/freshness; may write refreshed usage |
| Pool purchase | `POST /payment/buy-pool-with-account-credit`: `tariff_id` |
| Pool top-up | `POST /account/pool-keys/:id/topup`: `tariff_id` is mandatory |
| Pool cancellation | `POST /account/pool-keys/:id/cancel`; immediately disables key, backend refund policy |
| Pool URLs | `POST /account/pool-keys/:id/proxy-url`; protocol, country/carrier/city, sessions, failover, ASN/ISP/type, TTL and strict settings |
| Saved pool configs | `/account/pool/saved` list/save, `/:id` delete, `/:id/url` rebuild and update last_used_at |
| Active pool sessions | `/account/pool/sessions` list/close-all; `/:sessionKey` close-one; close-all must be explicitly selected |
| Tickets | `GET /tickets`: status/limit/offset; response `data:{tickets,total,limit,offset}`; create category/relatedProxies, no priority |
| Account webhooks | GET/PUT `/account/webhook`, POST `/account/webhook/test`; test sends real outbound event and records delivery |
| Subscriptions | `GET /account/subscriptions`; preserve unknown renewal/provider state |

## Limits that the MCP cannot repair

- The account handler itself can return zero if its internal account-credit lookup fails. The MCP detects missing/malformed/error responses but cannot detect a zero that the backend presents as valid. No backend financial logic was changed.
- Stock and usage are snapshots. Tool `observed_at` is not proof of the provider measurement time, physical availability or working HTTP/SOCKS5 listeners. Provider capabilities differ by server/modem.
- The deployed pool sanitizer accepts `state`, but its URL-building call does not forward that field. The MCP rejects it instead of promising ineffective state targeting. `carrier`/`city` are soft preferences; supported hard filters and failover must be chosen deliberately.
- The public API has no dedicated stop-auto-renew operation exposed here. Immediate modem cancellation must not be used to implement it. Card checkout/authentication, signup/wallet signing and admin credit/refund overrides remain outside this MCP's supported flows.
- Existing backend idempotency is not a universal exactly-once guarantee. The MCP binds/coalesces intents in memory and never automatically retries writes. Restarting loses that local memory; reconcile using preserved keys, receipts, ledger and account state. Approval fields are not server-enforced budgets or price locks.
- An HTTP 200 can contain a legacy refusal; the client checks it. An otherwise normal payment response must still be interpreted through its actual billing, settlement and provisioning fields. A failed webhook delivery is not a successful wiring test.
- The MCP does not provide server-management or shared-port repair APIs. No direct farmer/daemon, database, inventory-sync, reassignment or permission-bypass calls are present.

## Verification

Run `npm run check` for the fixture contract suite and `npm run test:package` for clean packaged installation and stdio startup. CI repeats these on supported Node versions. All state-changing test calls target loopback fixtures, and the suite isolates credentials/home storage. Public catalog smoke checks are separate and must remain unauthenticated reads.
