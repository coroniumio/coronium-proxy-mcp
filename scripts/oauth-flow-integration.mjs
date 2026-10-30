#!/usr/bin/env node
// End-to-end OAuth 2.1 + hosted MCP check against a LOCAL (or staging) instance.
//
// It walks the whole path a Claude client takes and fails loudly at the first step
// that does not match the contract:
//   1. unauthenticated MCP POST -> 401 with a Bearer resource_metadata challenge
//   2. protected resource metadata -> authorization server metadata
//   3. dynamic client registration (public client, loopback redirect)
//   4. /authorize with PKCE S256 -> consent page redirect
//   5. consent as a signed-in dashboard user (session cookie) -> authorization code
//   6. code -> tokens; MCP initialize, tools/list, read-only tool calls
//   7. refresh rotation, reuse detection (family revoked), RFC 7009 revoke
// It never calls a tool that buys, renews, tops up, cancels, rotates or replaces.
//
// Local setup (three processes):
//   backend:  MCP_OAUTH_ISSUER=http://127.0.0.1:5031 MCP_OAUTH_CONSENT_BASE=http://127.0.0.1:5000 node dist/src/bin/www.js
//   service:  PORT=5031 MCP_PUBLIC_URL=http://127.0.0.1:5031 MCP_ALLOWED_HOSTS=127.0.0.1:5031 \
//             CORONIUM_BASE_URL=http://127.0.0.1:5000/api/v3 node dist/http.js
//   this:     BACKEND_URL=http://127.0.0.1:5000 MCP_URL=http://127.0.0.1:5031/mcp \
//             CORONIUM_TEST_LOGIN=... CORONIUM_TEST_PASSWORD=... node scripts/oauth-flow-integration.mjs
// (or DASHBOARD_SESSION_COOKIE='JSESSION=...; JSESSION.sig=...' instead of login and password)
// In production nginx maps <issuer>/oauth/* to the backend's /api/oauth/*; locally this
// script calls the backend's /api/oauth/* directly.

import {createHash, randomBytes} from "node:crypto";

const BACKEND = (process.env.BACKEND_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:5031/mcp";
const REDIRECT = "http://127.0.0.1:53682/callback";
let step = 0;

function ok(message) {
    step += 1;
    console.log(`ok ${step} - ${message}`);
}

function fail(message, detail) {
    console.error(`not ok ${step + 1} - ${message}`);
    if (detail !== undefined) console.error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
    process.exit(1);
}

function expect(condition, message, detail) {
    if (!condition) fail(message, detail);
    ok(message);
}

async function request(url, options = {}) {
    const response = await fetch(url, {redirect: "manual", ...options});
    const text = await response.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return {status: response.status, headers: response.headers, body};
}

function form(values) {
    return {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams(values).toString()};
}

async function sessionCookie() {
    if (process.env.DASHBOARD_SESSION_COOKIE) return process.env.DASHBOARD_SESSION_COOKIE;
    const login = process.env.CORONIUM_TEST_LOGIN;
    const password = process.env.CORONIUM_TEST_PASSWORD;
    if (!login || !password) fail("set DASHBOARD_SESSION_COOKIE, or CORONIUM_TEST_LOGIN and CORONIUM_TEST_PASSWORD (a test account, never a customer)");
    const response = await fetch(`${BACKEND}/signin`, {method: "POST", redirect: "manual", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({login, password, ...(process.env.CORONIUM_TEST_2FA ? {code: process.env.CORONIUM_TEST_2FA} : {})})});
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (response.status !== 200 || !cookies.length) fail(`dashboard sign-in failed (HTTP ${response.status})`);
    return cookies.map(cookie => cookie.split(";")[0]).join("; ");
}

async function mcp(token, message) {
    return request(MCP_URL, {method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`}, body: JSON.stringify(message)});
}

async function main() {
    // 1. Discovery starts from a 401.
    const unauth = await request(MCP_URL, {method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json, text/event-stream"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/list"})});
    const challenge = unauth.headers.get("www-authenticate") || "";
    expect(unauth.status === 401 && /^Bearer /.test(challenge), "unauthenticated MCP POST is 401 with a Bearer challenge", {status: unauth.status, challenge});
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(Boolean(metadataUrl), "challenge names resource_metadata", challenge);

    // 2. Protected resource and authorization server metadata.
    const prm = await request(metadataUrl);
    expect(prm.status === 200 && prm.body.resource === MCP_URL, "protected resource metadata resource equals the MCP URL exactly", prm.body);
    const asMeta = await request(`${BACKEND}/api/oauth/metadata`);
    expect(asMeta.status === 200 && asMeta.body.issuer === prm.body.authorization_servers[0], "authorization server metadata issuer is the PRM's first authorization server", {as: asMeta.body.issuer, prm: prm.body.authorization_servers});
    expect(asMeta.body.code_challenge_methods_supported?.includes("S256") && asMeta.body.client_id_metadata_document_supported === true, "AS metadata advertises S256 and CIMD", asMeta.body);

    // 3. Dynamic client registration.
    const registration = await request(`${BACKEND}/api/oauth/register`, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({client_name: "Coronium integration check", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none"})});
    expect(registration.status === 201 && !registration.body.client_secret, "dynamic registration returns a public client", registration.body);
    const clientId = registration.body.client_id;

    // 4. Authorize with PKCE.
    const verifier = randomBytes(32).toString("base64url");
    const challengeValue = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(8).toString("hex");
    const authorize = await request(`${BACKEND}/api/oauth/authorize?${new URLSearchParams({response_type: "code", client_id: clientId, redirect_uri: REDIRECT.replace("53682", "61234"),
        code_challenge: challengeValue, code_challenge_method: "S256", state, resource: MCP_URL, scope: "read manage offline_access"})}`);
    const consentLocation = authorize.headers.get("location");
    expect(authorize.status === 302 && consentLocation?.includes("/api/v1/oauth/consent?request="), "authorize redirects to the consent page (loopback port ignored)", {status: authorize.status, location: consentLocation, body: authorize.body});
    const consentUrl = new URL(consentLocation);
    const requestId = consentUrl.searchParams.get("request");

    // 5. Consent as the signed-in dashboard user.
    const cookie = await sessionCookie();
    const anonymous = await request(`${BACKEND}/api/v1/oauth/requests/${requestId}`);
    expect(anonymous.status === 401, "consent JSON refuses a request without the dashboard session");
    const view = await request(`${BACKEND}/api/v1/oauth/requests/${requestId}`, {headers: {Cookie: cookie, Accept: "application/json"}});
    expect(view.status === 200 && view.body.csrf && view.body.buyer === false, "consent JSON describes the request for the signed-in user", view.body);
    const decision = await request(`${BACKEND}/api/v1/oauth/requests/${requestId}/decision`, {method: "POST",
        headers: {Cookie: cookie, "Content-Type": "application/json", "X-Coronium-Consent": "1", Origin: consentUrl.origin},
        body: JSON.stringify({approve: true, allow_spending: false, csrf: view.body.csrf})});
    expect(decision.status === 200 && decision.body.redirect, "approval returns the client redirect", decision.body);
    const back = new URL(decision.body.redirect);
    expect(back.searchParams.get("state") === state && back.searchParams.get("code"), "redirect carries the code and the original state");

    // 6. Tokens and MCP calls.
    const tokens = await request(`${BACKEND}/api/oauth/token`, form({grant_type: "authorization_code", code: back.searchParams.get("code"), code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT.replace("53682", "61234"), resource: MCP_URL}));
    expect(tokens.status === 200 && /^cmcp_at_/.test(tokens.body.access_token) && /^cmcp_rt_/.test(tokens.body.refresh_token), "code exchange returns opaque access and refresh tokens", {status: tokens.status, error: tokens.body.error});
    const init = await mcp(tokens.body.access_token, {jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "integration", version: "1"}}});
    expect(init.status === 200 && init.body.result?.serverInfo?.name === "coronium-proxy-mcp", "MCP initialize succeeds with the access token", init.body);
    const list = await mcp(tokens.body.access_token, {jsonrpc: "2.0", id: 2, method: "tools/list", params: {}});
    const names = (list.body.result?.tools || []).map(tool => tool.name);
    expect(names.length > 0 && !names.some(name => /^coronium_(buy|renew|topup|cancel)_/.test(name)), "tools/list on /mcp has no money tools", names);
    expect(list.body.result.tools.every(tool => tool.annotations?.title && typeof tool.annotations.readOnlyHint === "boolean" && typeof tool.annotations.destructiveHint === "boolean"), "every tool has a title and read-only and destructive hints");
    for (const name of ["coronium_get_capabilities", "coronium_get_account", "coronium_get_proxies", "coronium_list_tariffs"]) {
        const result = await mcp(tokens.body.access_token, {jsonrpc: "2.0", id: 3, method: "tools/call", params: {name, arguments: {}}});
        expect(result.status === 200 && result.body.result && result.body.result.isError !== true, `${name} works over the hosted server`, result.body);
    }

    // 7. Refresh rotation, reuse detection, revoke.
    const rotated = await request(`${BACKEND}/api/oauth/token`, form({grant_type: "refresh_token", refresh_token: tokens.body.refresh_token, client_id: clientId}));
    expect(rotated.status === 200 && rotated.body.refresh_token !== tokens.body.refresh_token, "refresh returns a new refresh token");
    const reuse = await request(`${BACKEND}/api/oauth/token`, form({grant_type: "refresh_token", refresh_token: tokens.body.refresh_token, client_id: clientId}));
    expect(reuse.status === 400 && reuse.body.error === "invalid_grant", "a rotated refresh token is refused with invalid_grant", reuse.body);
    // The MCP service may cache a verified bearer for up to 30 s, but every upstream call is
    // checked again by the API, so a tool call fails at once.
    const afterReuse = await mcp(rotated.body.access_token, {jsonrpc: "2.0", id: 4, method: "tools/call", params: {name: "coronium_get_account", arguments: {}}});
    expect(afterReuse.status === 401 || afterReuse.body?.result?.isError === true, "reuse revoked the whole family (the new access token no longer works)", afterReuse.body);
    const revoke = await request(`${BACKEND}/api/oauth/revoke`, form({token: rotated.body.refresh_token}));
    expect(revoke.status === 200, "RFC 7009 revoke answers 200");
    console.log(`\nall ${step} checks passed`);
}

main().catch(error => fail("unexpected error", error?.stack || String(error)));
