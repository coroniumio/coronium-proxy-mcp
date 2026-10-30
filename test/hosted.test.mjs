import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Hosted (Streamable HTTP) server contract. A fake Coronium API stands in for the
// backend: /api/v3/mcp/session answers for OAuth access tokens, /api/v3/account for
// raw dashboard API tokens and everything else the tools read.
const home = mkdtempSync(join(tmpdir(), 'coronium-mcp-hosted-'));
process.env.HOME = home;
process.env.DOTENV_CONFIG_PATH = join(home, 'absent.env');
for (const key of Object.keys(process.env)) if (/^CORONIUM_|^TOKEN_ENCRYPTION_KEY$|^MCP_/.test(key)) delete process.env[key];

const ids = {tariff: '333333333333333333333333', country: '222222222222222222222222', carrier: 'aaaaaaaaaaaaaaaaaaaaaaaa'};
const directoryTools = JSON.parse(readFileSync(new URL('./profiles/directory.json', import.meta.url), 'utf8'));
const buyerTools = JSON.parse(readFileSync(new URL('./profiles/buyer.json', import.meta.url), 'utf8'));
const buyerSpendingTools = JSON.parse(readFileSync(new URL('./profiles/buyer-spending.json', import.meta.url), 'utf8'));
const MONEY = /^coronium_(buy|renew|topup|cancel)_/;

function jwt(payload) {
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({alg: 'HS256', typ: 'JWT'})}.${part(payload)}.c2lnbmF0dXJlLWZpeHR1cmU`;
}

let sessions = new Map();
let requests = [];
let backendDown = false;
const API_TOKEN = jwt({_userId: 'u-api', kind: 'api', jti: 'fixture'});
const LOGIN_JWT = jwt({id: 'u-login', login: 'someone@example.invalid'});

function json(res, value, status = 200) {res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value));}
const backend = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const path = url.pathname.replace(/^\/api\/v3/, '');
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    requests.push({method: req.method, path, auth, body, headers: req.headers});
    if (backendDown) return json(res, {error: 'down'}, 502);
    const session = sessions.get(auth);
    if (path === '/mcp/session') {
        if (!session) return json(res, {error: 'invalid_token'}, 401);
        return json(res, {connection_id: session.connection_id, resource: session.resource, scopes: session.scopes, spending_enabled: session.spending_enabled, expires_at: Date.now() + 3600_000, user_display: 'f***@example.invalid'});
    }
    if (path === '/tariffs/available') return json(res, {data: [{_id: ids.tariff, country_code: 'US', country_id: ids.country, carrier_id: ids.carrier, stock: 8, price: 129, period: 30, features: {p0f: {count: 0, all: false}}}]});
    const known = session || auth === API_TOKEN;
    if (!known) return json(res, {error: 'Not authenticated'}, 401);
    if (path === '/account') {
        // A small delay makes concurrent requests interleave.
        await new Promise(resolve => setTimeout(resolve, Math.random() * 30));
        return json(res, {_id: session ? session.user : 'u-api', login: session ? `${session.user}@example.invalid` : 'api@example.invalid', accountCredit: 320, btc: {balance: 0}, usdt: {balance: 0}, proxyCount: 0});
    }
    if (path === '/account/proxies') return json(res, {data: []});
    if (path === '/payment/buy-with-account-credit') return json(res, {result: 'ok', charged_usd: 129, currency: 'USD', payment_id: 'fixture-payment', data: [{_id: 'b'.repeat(24)}]});
    return json(res, {result: 'ok', data: {}});
});

let hosted;
let base = '';
const logs = [];
before(async () => {
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    process.env.CORONIUM_BASE_URL = `http://127.0.0.1:${backend.address().port}/api/v3`;
    const {createHostedServer} = await import('../dist/http-server.js');
    hosted = createHostedServer({
        publicUrl: 'https://api.coronium.example', apiBaseUrl: process.env.CORONIUM_BASE_URL,
        allowedHosts: [], allowedOrigins: ['https://claude.ai', 'https://claude.com'], log: line => logs.push(line),
    });
    await new Promise(resolve => hosted.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${hosted.address().port}`;
});
after(async () => {
    await new Promise(resolve => hosted.close(resolve));
    await new Promise(resolve => backend.close(resolve));
    rmSync(home, {recursive: true, force: true});
});
beforeEach(() => {requests = []; backendDown = false; sessions = new Map();});

const RES = {directory: 'https://api.coronium.example/mcp', buyer: 'https://api.coronium.example/mcp/buyer'};
function grant({resource = RES.directory, scopes = ['read', 'manage'], spending = false, user = 'u1'} = {}) {
    const token = `cmcp_at_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    sessions.set(token, {connection_id: randomUUID(), resource, scopes, spending_enabled: spending, user});
    return token;
}
async function connect(path, token, headers = {}) {
    const client = new Client({name: 'hosted-tests', version: '1.0.0'});
    const transport = new StreamableHTTPClientTransport(new URL(base + path), {requestInit: {headers: {Authorization: `Bearer ${token}`, ...headers}}});
    await client.connect(transport);
    return client;
}
async function toolNames(path, token) {
    const client = await connect(path, token);
    try {
        return (await client.listTools()).tools.map(tool => tool.name);
    } finally {
        await client.close();
    }
}
function rpc(path, token, message, headers = {}) {
    return fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? {Authorization: `Bearer ${token}`} : {}), ...headers}, body: JSON.stringify(message)});
}
const LIST = {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}};

test('no token: 401 with a Bearer challenge that points at the protected resource metadata', async () => {
    for (const [path, metadata] of [['/mcp', '/.well-known/oauth-protected-resource/mcp'], ['/mcp/buyer', '/.well-known/oauth-protected-resource/mcp/buyer']]) {
        const response = await rpc(path, null, LIST);
        assert.equal(response.status, 401);
        const header = response.headers.get('www-authenticate');
        assert.match(header, /^Bearer /);
        assert.match(header, new RegExp(`resource_metadata="https://api\\.coronium\\.example${metadata.replaceAll('/', '\\/')}"`));
        assert.match(header, /scope="read manage"/);
    }
    assert.equal(requests.length, 0);
});

test('a bad or unknown token is 401 invalid_token, a login JWT is refused, and a token in the URL is refused', async () => {
    for (const token of ['cmcp_at_unknown-token-value-000000', LOGIN_JWT, 'not-a-token-at-all-but-long-enough']) {
        const response = await rpc('/mcp', token, LIST);
        assert.equal(response.status, 401, token);
        assert.match(response.headers.get('www-authenticate'), /error="invalid_token"/);
    }
    assert(!requests.some(request => request.auth === LOGIN_JWT));
    const query = await fetch(`${base}/mcp?access_token=${grant()}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(LIST)});
    assert.equal(query.status, 400);
});

test('protected resource metadata: resource equals the URL exactly, buyer adds spend, root alias is /mcp', async () => {
    const directory = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(directory.resource, RES.directory);
    assert.deepEqual(directory.authorization_servers, ['https://api.coronium.example']);
    assert.deepEqual(directory.scopes_supported, ['read', 'manage']);
    assert.deepEqual(directory.bearer_methods_supported, ['header']);
    const buyer = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp/buyer`)).json();
    assert.equal(buyer.resource, RES.buyer);
    assert.deepEqual(buyer.scopes_supported, ['read', 'manage', 'spend']);
    assert.deepEqual(await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json(), directory);
    assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource/other`)).status, 404);
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), {ok: true, version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version});
});

test('/mcp never lists a money tool, whatever the token holds; read-only scope hides writes', async () => {
    const full = await toolNames('/mcp', grant({scopes: ['read', 'manage', 'spend'], spending: true}));
    assert.deepEqual(full.sort(), [...directoryTools].sort());
    assert(!full.some(name => MONEY.test(name)));
    const readOnly = await toolNames('/mcp', grant({scopes: ['read']}));
    for (const name of ['coronium_rotate_modem', 'coronium_replace_modem', 'coronium_test_modem', 'coronium_create_ticket', 'coronium_reply_to_ticket']) assert(!readOnly.includes(name), name);
    assert(readOnly.includes('coronium_get_proxies'));
});

test('/mcp/buyer: money tools only with spend AND the connection switch on (off by default)', async () => {
    const noSpend = await toolNames('/mcp/buyer', grant({resource: RES.buyer}));
    assert.deepEqual(noSpend.sort(), [...buyerTools].sort());
    const switchOff = await toolNames('/mcp/buyer', grant({resource: RES.buyer, scopes: ['read', 'manage', 'spend'], spending: false}));
    assert.deepEqual(switchOff.sort(), [...buyerTools].sort());
    const switchOn = await toolNames('/mcp/buyer', grant({resource: RES.buyer, scopes: ['read', 'manage', 'spend'], spending: true}));
    assert.deepEqual(switchOn.sort(), [...buyerSpendingTools].sort());
    // The switch alone never enables spending without the scope.
    const switchWithoutScope = await toolNames('/mcp/buyer', grant({resource: RES.buyer, scopes: ['read', 'manage'], spending: true}));
    assert(!switchWithoutScope.some(name => MONEY.test(name)));
});

test('a money call without the spend scope is a 403 insufficient_scope step-up, and nothing reaches the payment API', async () => {
    const response = await rpc('/mcp/buyer', grant({resource: RES.buyer}), {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'coronium_buy_modems_with_balance', arguments: {tariff_id: ids.tariff}}});
    assert.equal(response.status, 403);
    const header = response.headers.get('www-authenticate');
    assert.match(header, /error="insufficient_scope"/);
    assert.match(header, /scope="read manage spend"/);
    assert(!requests.some(request => request.path.startsWith('/payment/')));
});

test('with spend and the switch on, a purchase still needs the quoted total, confirm and a key, and sends the caller bearer', async () => {
    const token = grant({resource: RES.buyer, scopes: ['read', 'manage', 'spend'], spending: true});
    const client = await connect('/mcp/buyer', token);
    try {
        const refused = await client.callTool({name: 'coronium_buy_modems_with_balance', arguments: {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129}});
        assert.equal(refused.isError, true);
        assert(!requests.some(request => request.path.startsWith('/payment/')));
        const key = randomUUID();
        const bought = await client.callTool({name: 'coronium_buy_modems_with_balance', arguments: {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: key}});
        assert.notEqual(bought.isError, true, JSON.stringify(bought));
        const payment = requests.filter(request => request.path === '/payment/buy-with-account-credit');
        assert.equal(payment.length, 1);
        assert.equal(payment[0].auth, token);
        assert.equal(payment[0].headers['idempotency-key'], key);
        const capabilities = JSON.parse((await client.callTool({name: 'coronium_get_capabilities', arguments: {}})).content[0].text).data;
        assert.equal(capabilities.transport, 'streamable-http');
        assert.equal(capabilities.auth, 'oauth');
        assert.equal(capabilities.spending_enabled, true);
        assert(!JSON.stringify(capabilities).includes(token));
    } finally {
        await client.close();
    }
});

test('audience: a token issued for /mcp/buyer is refused on /mcp and the reverse', async () => {
    assert.equal((await rpc('/mcp', grant({resource: RES.buyer}), LIST)).status, 401);
    assert.equal((await rpc('/mcp/buyer', grant({resource: RES.directory}), LIST)).status, 401);
});

test('origin: a browser origin other than Claude is refused; Claude origins and no origin pass', async () => {
    const token = grant();
    assert.equal((await rpc('/mcp', token, LIST, {Origin: 'https://evil.example'})).status, 403);
    assert.equal((await rpc('/mcp', token, LIST, {Origin: 'https://claude.ai'})).status, 200);
    assert.equal((await rpc('/mcp', token, LIST)).status, 200);
});

test('GET and DELETE are 405 (stateless, no server-initiated streams)', async () => {
    for (const method of ['GET', 'DELETE']) {
        const response = await fetch(`${base}/mcp`, {method, headers: {Authorization: `Bearer ${grant()}`}});
        assert.equal(response.status, 405);
    }
});

test('context isolation: concurrent requests with different tokens never cross', async () => {
    const users = Array.from({length: 12}, (_, index) => ({user: `user${index}`, token: grant({user: `user${index}`})}));
    const results = await Promise.all(users.map(async ({user, token}) => {
        const client = await connect('/mcp', token);
        try {
            const result = await client.callTool({name: 'coronium_get_account', arguments: {}});
            return {user, login: JSON.parse(result.content[0].text).data.account.login};
        } finally {
            await client.close();
        }
    }));
    for (const {user, login} of results) assert.equal(login, `${user}@example.invalid`);
    for (const request of requests.filter(item => item.path === '/account')) assert(sessions.has(request.auth));
});

test('a raw dashboard API token works for API clients but can never spend', async () => {
    const names = await toolNames('/mcp/buyer', API_TOKEN);
    assert(!names.some(name => MONEY.test(name)));
    assert((await toolNames('/mcp', API_TOKEN)).includes('coronium_rotate_modem'));
});

test('an unreachable API is a 503, never a 401 that would force a new sign-in', async () => {
    backendDown = true;
    const response = await rpc('/mcp', 'cmcp_at_some-token-that-cannot-be-checked', LIST);
    assert.equal(response.status, 503);
});

test('request logs carry method, tool and argument names only, never bearers or values', async () => {
    const token = grant();
    logs.length = 0;
    const client = await connect('/mcp', token);
    await client.callTool({name: 'coronium_create_ticket', arguments: {subject: 'secret-subject-text', message: 'secret-body-text'}});
    await client.close();
    const text = JSON.stringify(logs);
    assert(!text.includes(token));
    assert(!text.includes('secret-subject-text'));
    assert(!text.includes('secret-body-text'));
    assert.match(text, /coronium_create_ticket/);
    assert.match(text, /"subject"/);
});

test('the hosted server refuses to start with host credentials or spending in its environment', async () => {
    const {hostedOptionsFromEnvironment} = await import('../dist/http-server.js');
    for (const name of ['CORONIUM_API_TOKEN', 'CORONIUM_PASSWORD', 'CORONIUM_ENABLE_SPENDING']) {
        assert.throws(() => hostedOptionsFromEnvironment({[name]: '1'}), /refuses to start/);
    }
    assert.throws(() => hostedOptionsFromEnvironment({MCP_PUBLIC_URL: 'http://api.coronium.io'}), /HTTPS/);
    const options = hostedOptionsFromEnvironment({CORONIUM_BASE_URL: 'http://127.0.0.1:5000/api/v3'});
    assert.equal(options.publicUrl, 'https://api.coronium.io');
    assert.deepEqual(options.allowedHosts, ['api.coronium.io']);
    assert.equal(options.apiBaseUrl, 'http://127.0.0.1:5000/api/v3');
});
