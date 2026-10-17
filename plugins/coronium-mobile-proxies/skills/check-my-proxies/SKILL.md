---
name: check-my-proxies
description: Use when the user asks whether their Coronium mobile proxies are working, which ones are down, slow or about to expire, or wants a health check, a connectivity test, or a fresh IP on a proxy that is not behaving.
---

# Check my proxies

A health check across the user's Coronium proxies, from overview to fix. Only use the Coronium tools this plugin provides. Do not call a tool the user's request does not need.

## 1. Overview

1. Call `coronium_get_proxy_health` once for the health snapshot of all owned proxies.
2. Call `coronium_get_proxies` for names, countries and expiry dates. If the user named a country, pass `country_code`.
3. Summarise in a short list, one line per proxy: name, country, the health `status` (active, degraded, dead or expired) and `recommendation` as returned, current IP if known, and expiry date. Put problems first. Flag any proxy that expires within 7 days.

Do not print usernames, passwords or rotation tokens in the overview. Connection details belong to the `connect-my-proxy` skill.

If the user has no proxies, say so and point them to https://dashboard.coronium.io to get one. Do not quote prices unless asked.

## 2. Test

The health snapshot is evidence, not proof. When the user wants to know whether a specific proxy really works, or agrees to test the ones that look unhealthy, call `coronium_test_modem` for each of those proxies (one at a time). Report the protocol and result exactly as returned. A listed SOCKS5 port is not proof that SOCKS5 works.

## 3. Fix with a rotation

Rotation asks the carrier for a fresh IP. Offer it when a proxy is online but slow, blocked by a site the user is testing, or failing the test.

1. Before rotating, tell the user: "Rotating gives this proxy a new IP. Open connections through it drop for about 10 to 60 seconds." Ask for an explicit yes.
2. Only after the user agrees, call `coronium_rotate_modem` with the proxy and `confirm: true`. Rotate one proxy per approval.
3. Read the result:
   - A new IP: report the old and new IP.
   - `rotating` or pending: the rotation is still running. Call `coronium_get_rotation_status` after about 30 seconds and report what it says. Never start another rotation while one is pending, and never treat a pending rotation as a failure. Check the status at most three times, then tell the user it is still running and stop. If the status says `failed`, report the failure and its reason; do not keep polling.
   - The IP did not change: the attempt ran but the carrier returned the same IP. The user can try again after the cooldown.
   - Refused with HTTP 429: the proxy is in its cooldown between rotations. Tell the user how long to wait, using `retry_after_seconds` or the wait time in the error message, or about a minute when neither is given. Do not retry on your own.
   - Any other error: show the message and stop.
4. Never retry a rotation automatically, and never replace, restart or reconfigure a proxy as a recovery step unless the user asks for that specific action.

## 4. Still not working

If a proxy stays offline or keeps failing tests after a rotation, suggest a support ticket. If the user agrees and `coronium_create_ticket` is available, draft a short subject and message (proxy name, country, what fails, since when, test results), show the draft, and create the ticket only after the user approves it. Otherwise give them hello@coronium.io.

Renewing an expiring proxy happens in the dashboard. If the user asks what it costs, `coronium_get_renewal_quote` gives a quote; this plugin cannot pay.
