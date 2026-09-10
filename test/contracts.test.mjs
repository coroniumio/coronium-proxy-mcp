import assert from 'node:assert/strict';
import {after, afterEach, beforeEach, test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// No production credentials or endpoints enter this test process or its children.
const home = mkdtempSync(join(tmpdir(), 'coronium-mcp-contract-'));
process.env.HOME = home;
process.env.DOTENV_CONFIG_PATH = join(home, 'absent.env');
for (const key of Object.keys(process.env)) if (/^CORONIUM_|^TOKEN_ENCRYPTION_KEY$/.test(key)) delete process.env[key];
process.env.CORONIUM_API_TOKEN = 'fixture-token';
const ids = {modem: '111111111111111111111111', second: 'aaaaaaaaaaaaaaaaaaaaaaaa', country: '222222222222222222222222', tariff: '333333333333333333333333', pool: '444444444444444444444444', key: '555555555555555555555555', ticket: '666666666666666666666666', saved: '777777777777777777777777'};
const proxy = {_id: ids.modem, name: 'cor_US_fixture', country_id: ids.country, connection_ip: '203.0.113.8', http_port: 18080, socks_port: 18081, proxy_login: 'name@user', proxy_password: 'p:a/ss', isOnline: true, tariff_expired_at: Date.now() + 86400_000, restartToken: '123e4567-e89b-42d3-a456-426614174000', features: {p0f: {server_supported: false}, openvpn: {available: false}}};
let requests = [];
let overrides = new Map();
let connections = [];
function json(res, value, status = 200, headers = {}) {res.writeHead(status, {'Content-Type': 'application/json', ...headers}); res.end(JSON.stringify(value));}
const backend = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const path = url.pathname.replace(/^\/api\/v3/, '');
    const record = {method: req.method, path, query: Object.fromEntries(url.searchParams), body, headers: req.headers};
    requests.push(record);
    const override = overrides.get(`${req.method} ${path}`);
    if (override) return override(req, res, record);
    const isPublic = ['/countries', '/tariffs/available', '/free-modems', '/get-token', '/api/v1/tariffs'].includes(path) || path.startsWith('/modems/rotate-modem-by-token/');
    if (!isPublic && !req.headers.authorization) return json(res, {error: 'Not authenticated'}, 401);
    if (path === '/get-token') return json(res, {token: 'login-fixture-token'});
    if (path === '/account') return json(res, {_id: 'fixture-account', login: 'fixture@example.invalid', accountCredit: 320, btc: {balance: 0.003}, usdt: {balance: 17}, proxyCount: 1});
    if (path === '/countries') return json(res, {data: [{_id: ids.country, country_code: 'US', name: 'United States'}]});
    if (path === '/tariffs/available') return json(res, {data: [{_id: ids.tariff, country_code: 'US', country_id: ids.country, carrier_id: ids.second, stock: 8, price: 129, period: 30, features: {p0f: {count: 0, all: false}}}], _cached: true, _ageMs: 120});
    if (path === '/api/v1/tariffs') return json(res, {data: [{_id: ids.pool, name: {en: 'Pool 10 GB'}, type: 'pool', traffic_cap_gb: 10, duration_days: 60, price: 50, pool_kind: 'any', deletedAt: null, stripe_price_id: 'internal-never-expose'}, {_id: ids.tariff, type: 'modem', price: 129}, {_id: ids.second, type: 'pool', deletedAt: 1}]});
    if (path === '/free-modems') return json(res, {data: [{country_id: ids.country, carrier_id: ids.second, count: 8}]});
    if (path === '/account/proxies') return json(res, {data: [proxy]});
    if (path === '/account/crypto-balance') return json(res, [{coin: 'btc', balance: 0.003, address: 'fixture-address'}, {coin: 'usdt', balance: 17}, {coin: 'account_credit', balance: 320}]);
    if (path === '/payment/renewal-quote') return json(res, {currency: 'USD', total_usd: 129, total_cents: 12900, line_items: body.modems.map(modem => ({modem_id: modem.modem_id, days: modem.days, usd: 129}))});
    if (path === '/account/pool-keys') return json(res, {data: [{_id: ids.key, traffic_cap_gb: 10, traffic_used_gb: 2.25, traffic_synced_at: 1234, sync_stale_minutes: 2, status: 'active'}]});
    if (path === '/tickets' && req.method === 'GET') return json(res, {data: {tickets: [{_id: ids.ticket, subject: 'Fixture', status: 'pending'}], total: 7, limit: Number(record.query.limit), offset: Number(record.query.offset)}});
    if (path.endsWith('/p0f-options')) return json(res, {data: {supported: true, options: ['linux', 'android'], current: ''}});
    if (path.endsWith('/rotation-status')) return json(res, {state: 'done', ext_ip: '203.0.113.9', elapsedMs: 200});
    if (path.endsWith('/restart')) return json(res, {result: 'ok', rotated: true, ip: '203.0.113.9'});
    if (path.startsWith('/modems/rotate-modem-by-token/')) return json(res, {result: 'ok', ext_ip: '203.0.113.9', new_ip: '203.0.113.9'});
    if (path.endsWith('/openvpn')) {res.writeHead(200, {'Content-Type': 'application/octet-stream'}); return res.end('<client>\nclient\nremote fixture.invalid 1194\n</client>');}
    if (path === '/account/webhook/test') return json(res, {delivered: true, status_code: 204});
    if (path.startsWith('/payment/') || path.endsWith('/topup') || path.endsWith('/cancel')) return json(res, {result: 'ok', payment_id: 'fixture-payment', billing: {currency: 'USD', total: 129}, ...body}, 200, {'x-request-id': 'fixture-request', 'x-idempotency-replay': 'false'});
    return json(res, {result: 'ok', data: {path, ...body}});
});
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
process.env.CORONIUM_BASE_URL = `http://127.0.0.1:${backend.address().port}/api/v3`;
const {createServer} = await import('../dist/mcp-server.js');
const {config} = await import('../dist/config.js');
const {api, CoroniumAPI} = await import('../dist/api-client.js');
const {tokenStore} = await import('../dist/token-store.js');
const {proxyUrl, finiteNumber} = await import('../dist/formatters.js');
const {redact} = await import('../dist/errors.js');

async function connect() {
    const server = createServer();
    const client = new Client({name: 'contract-tests', version: '1.0.0'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    connections.push({client, server});
    return client;
}
async function call(name, args = {}, client) {
    client ||= await connect();
    return client.callTool({name: `coronium_${name}`, arguments: args}, undefined, {timeout: 10_000});
}
function data(result) {assert.notEqual(result.isError, true, JSON.stringify(result)); assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent); return result.structuredContent.data;}
function error(result, code) {assert.equal(result.isError, true); if (code) assert.equal(result.structuredContent?.error?.code, code); return result.structuredContent?.error;}
function last(path) {return requests.filter(request => request.path === path).at(-1);}
beforeEach(() => {requests = []; overrides = new Map(); config.readOnly = false; config.login = undefined; config.password = undefined; config.autoLoginOn401 = true; config.tokenEncryptionKey = undefined; config.timeoutMs = 30_000; config.actionTimeoutMs = 180_000; tokenStore.set('fixture-token');});
afterEach(async () => {await Promise.all(connections.splice(0).map(async ({client, server}) => {await client.close(); await server.close();}));});
after(async () => {await new Promise(resolve => backend.close(resolve)); rmSync(home, {recursive: true, force: true});});

test('MCP initialization, all tool schemas, annotations, resources and prompts', async () => {
    const client = await connect();
    assert.equal(client.getServerVersion().version, '2.0.0');
    const {tools} = await client.listTools();
    assert.equal(tools.length, 59);
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
    for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object', tool.name);
        assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
        assert.equal(tool.outputSchema.type, 'object', tool.name);
        assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
        assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
        assert.equal(tool.annotations.openWorldHint, true);
    }
    const cancellation = tools.find(tool => tool.name === 'coronium_cancel_modem');
    assert.match(cancellation.description, /IMMEDIATELY/);
    assert.equal(cancellation.annotations.destructiveHint, true);
    assert(cancellation.inputSchema.required.includes('confirm'));
    assert.equal((await client.listResources()).resources.length, 1);
    assert.match((await client.readResource({uri: 'coronium://guide'})).contents[0].text, /never automatically retries a write/);
    assert.equal((await client.listPrompts()).prompts.length, 2);
    assert.match((await client.getPrompt({name: 'choose-proxy', arguments: {requirements: 'US SOCKS5'}})).messages[0].content.text, /US SOCKS5/);
    assert.equal(data(await call('get_capabilities', {}, client)).read_only, false);
});

test('native balances use /account only, preserve USD credit and both coins', async () => {
    const balances = data(await call('get_balance'));
    assert.deepEqual(balances, {account_credit: {amount: 320, currency: 'USD'}, btc: {amount: 0.003, currency: 'BTC'}, usdt: {amount: 17, currency: 'USDT'}});
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, 'Bearer fixture-token');
    assert.deepEqual(requests[0].query, {});
});

test('missing or unavailable balances never become zero', async () => {
    overrides.set('GET /account', (_, res) => json(res, {balance: 0, btc: {balance: 0}, usdt: {balance: 0}}));
    error(await call('get_balance'), 'invalid_response');
    overrides.set('GET /account', (_, res) => json(res, {error: 'Unavailable'}, 503));
    error(await call('get_balance'), 'http_503');
    for (const value of [null, undefined, '', '  ', [], {}, true, 'NaN', Infinity]) assert.throws(() => finiteNumber(value, 'balance'));
    assert.equal(finiteNumber('0', 'balance'), 0);
});

test('owned proxy host, credentials, country and capability normalization', async () => {
    const result = data(await call('get_proxies', {country_code: 'us', online_only: true, expiring_within_days: 2}));
    assert.equal(result.count, 1);
    const p = result.proxies[0];
    assert.equal(p.host, '203.0.113.8');
    assert.equal(p.country_code, 'US');
    assert.equal(p.http_url, 'http://name%40user:p%3Aa%2Fss@203.0.113.8:18080');
    assert.equal(p.socks5_url, 'socks5://name%40user:p%3Aa%2Fss@203.0.113.8:18081');
    assert.equal(p.restartToken, proxy.restartToken);
    assert.equal(p.features.p0f.server_supported, false);
    assert.equal(p.connection_verified_by_this_tool, false);
    assert.equal(data(await call('get_proxies', {country_code: 'PL'})).count, 0);
    assert.equal(data(await call('get_proxy', {proxy: proxy.name})).proxy._id, ids.modem);
});

test('IPv6 URLs and missing connection details are handled without fabricating hosts', () => {
    assert.equal(proxyUrl('socks5', '2001:db8::8', 1080, 'u', 'p'), 'socks5://u:p@[2001:db8::8]:1080');
    assert.equal(proxyUrl('http', null, 80, 'u', 'p'), null);
    assert.equal(proxyUrl('http', 'invalid/host', 80, 'u', 'p'), null);
    assert.equal(proxyUrl('http', 'example.invalid', 65536, 'u', 'p'), null);
});

test('catalog country filter, stock freshness and unauthenticated public reads', async () => {
    assert.equal(data(await call('list_tariffs', {country_code: 'US'})).age_ms, 120);
    assert.equal(data(await call('list_tariffs', {country_code: 'PL'})).count, 0);
    assert.equal(data(await call('list_free_modems', {country_code: 'us'})).stock[0].count, 8);
    assert(requests.every(request => !request.headers.authorization));
});

test('malformed country lookup is an error, not a false empty proxy list', async () => {
    overrides.set('GET /countries', (_, res) => json(res, {error: 'unavailable'}, 503));
    error(await call('get_proxies', {country_code: 'US'}), 'http_503');
});

test('purchase uses account credit and the real body, preserving full billing receipt', async () => {
    const key = randomUUID();
    const result = data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 2, funding_source: 'account_credit', country_code: 'us', coupon: 'SAVE', metadata: {job: 'fixture'}, want_p0f: false, confirm: true, idempotency_key: key}));
    const request = last('/payment/buy-with-account-credit');
    assert.deepEqual(request.body, {tariff_id: ids.tariff, modemCount: 2, coupon: {coupon_name: 'SAVE'}, metadata: '{"job":"fixture"}', wantP0f: false});
    assert.equal(request.headers['idempotency-key'], key);
    assert.equal(result.response.billing.total, 129);
    assert.equal(result.request.idempotency_key, key);
    assert.equal(result.request.request_id, 'fixture-request');
    assert.equal(result.request.replayed, false);
});

test('BTC purchase selects BTC route, not USD credit', async () => {
    data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', confirm: true, idempotency_key: randomUUID()}));
    assert(last('/payment/buy-modems-with-crypto-balance'));
    assert(!last('/payment/buy-with-account-credit'));
});

test('buy rejects missing authorization, unsupported inputs and key before HTTP', async () => {
    const valid = {tariff_id: ids.tariff, quantity: 1, confirm: true, idempotency_key: randomUUID()};
    for (const args of [{...valid, confirm: false}, {...valid, confirm: undefined}, {...valid, idempotency_key: undefined}, {...valid, funding_source: 'usdt'}, {...valid, unexpected: 'ignored?'}, {...valid, quantity: 0}]) error(await call('buy_modems_with_balance', args));
    assert.equal(requests.length, 0);
});

test('country and quantity preflight failures do not spend', async () => {
    const args = {tariff_id: ids.tariff, quantity: 1, confirm: true, idempotency_key: randomUUID()};
    error(await call('buy_modems_with_balance', {...args, country_code: 'PL'}), 'tariff_unavailable');
    error(await call('buy_modems_with_balance', {...args, quantity: 9}), 'insufficient_stock');
    assert(requests.every(request => request.method === 'GET'));
});

test('renewal quote and checkout use modem IDs/days, normalize IDs and omit tariff', async () => {
    const modems = [{modem_id: ids.second.toUpperCase(), days: 30}];
    const result = data(await call('renew_modems_with_balance', {modems, coupon: 'SAVE', confirm: true, idempotency_key: randomUUID()}));
    assert.equal(result.quote_before_submission.total_usd, 129);
    assert.deepEqual(last('/payment/renew-with-account-credit').body, {modems: [{modem_id: ids.second, days: 30}], coupon: {coupon_name: 'SAVE'}});
    assert(!('tariff_id' in last('/payment/renew-with-account-credit').body));
    data(await call('renew_modems_with_balance', {modems, funding_source: 'btc', confirm: true, idempotency_key: randomUUID()}));
    assert(last('/payment/renew-modems-with-crypto-balance'));
});

test('partial ownership quote and duplicate modem IDs block renewal', async () => {
    const args = {modems: [{modem_id: ids.modem, days: 30}, {modem_id: ids.second, days: 7}], confirm: true, idempotency_key: randomUUID()};
    overrides.set('POST /payment/renewal-quote', (_, res) => json(res, {total_usd: 129, line_items: [{modem_id: ids.modem}]}));
    error(await call('renew_modems_with_balance', args), 'incomplete_renewal_quote');
    assert.equal(requests.length, 1);
    requests = [];
    error(await call('get_renewal_quote', {modems: [{modem_id: ids.modem, days: 30}, {modem_id: ids.modem, days: 7}]}));
    error(await call('get_renewal_quote', {modems: [{modem_id: ids.modem, days: 91}]}));
    assert.equal(requests.length, 0);
});

test('coupon uses coupon_name', async () => {
    data(await call('check_coupon', {code: 'SAVE'}));
    assert.deepEqual(last('/coupons/check').body, {coupon_name: 'SAVE'});
});

test('same concurrent payment intent is submitted once; payload or route reuse is blocked', async () => {
    const api = new CoroniumAPI();
    const key = randomUUID();
    const body = {tariff_id: ids.tariff, modemCount: 1};
    const values = await Promise.all([api.payment('/payment/buy-with-account-credit', body, key), api.payment('/payment/buy-with-account-credit', body, key)]);
    assert.deepEqual(values[0], values[1]);
    assert.equal(requests.length, 1);
    await assert.rejects(api.payment('/payment/buy-with-account-credit', {...body, modemCount: 2}, key), error => error.details.code === 'idempotency_conflict');
    await assert.rejects(api.payment('/payment/buy-modems-with-crypto-balance', body, key), error => error.details.code === 'idempotency_conflict');
    assert.equal(requests.length, 1);
});

test('HTTP 401 insufficient BTC never triggers login or write replay', async () => {
    config.login = 'fixture@example.invalid'; config.password = 'fixture-password';
    overrides.set('POST /payment/buy-modems-with-crypto-balance', (_, res) => json(res, {error: 'Insufficient balance', required: 0.02, available: 0.001}, 401));
    const result = await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', confirm: true, idempotency_key: randomUUID()});
    const detail = error(result, 'http_401');
    assert.equal(detail.details.available, 0.001);
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});

test('ambiguous payment failure retains intent key and does not resubmit after another call', async () => {
    const client = new CoroniumAPI();
    const key = randomUUID();
    overrides.set('POST /payment/failure', (_, res) => json(res, {error: 'Upstream lost response', request_id: 'trace-fixture'}, 502));
    for (let n = 0; n < 2; n++) await assert.rejects(client.payment('/payment/failure', {}, key), error => error.details.outcome === 'unknown' && error.details.idempotency_key === key && error.details.request_id === 'trace-fixture');
    assert.equal(requests.length, 1);
});

test('network timeout is unknown for a write and does not retry', async () => {
    config.actionTimeoutMs = 20;
    overrides.set('POST /payment/timeout', (_, res) => setTimeout(() => json(res, {result: 'ok'}), 70));
    const client = new CoroniumAPI();
    const key = randomUUID();
    await assert.rejects(client.payment('/payment/timeout', {}, key), error => error.details.outcome === 'unknown' && error.details.idempotency_key === key);
    assert.equal(requests.length, 1);
});

test('HTML success is rejected and mutation outcome remains unknown', async () => {
    const html = (_, res) => {res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<html>maintenance</html>');};
    overrides.set('GET /account', html);
    error(await call('get_balance'), 'invalid_response');
    overrides.set('POST /payment/html', html);
    await assert.rejects(new CoroniumAPI().payment('/payment/html', {}, randomUUID()), error => error.details.outcome === 'unknown');
});

test('error details preserve request IDs and Retry-After, redact credentials', async () => {
    overrides.set('GET /account', (_, res) => json(res, {code: 'rate_limited', error: 'Try later Bearer fixture-secret', password: 'fixture-password', api_key: 'fixture-key'}, 429, {'retry-after': '45', 'x-request-id': 'trace-429'}));
    const result = await call('get_balance');
    const detail = error(result, 'rate_limited');
    assert.equal(detail.retry_after_seconds, 45);
    assert.equal(detail.request_id, 'trace-429');
    assert(!JSON.stringify(result).includes('fixture-secret'));
    assert(!JSON.stringify(result).includes('fixture-password'));
    assert(!JSON.stringify(result).includes('fixture-key'));
    assert.equal(redact('https://user:pass@example.invalid/a?token=abc'), 'https://[redacted]@example.invalid/a?token=[redacted]');
});

test('redirects never forward the bearer token to a different destination', async () => {
    overrides.set('GET /account', (_, res) => {res.writeHead(302, {Location: 'https://must-not-contact.invalid/'}); res.end();});
    error(await call('get_account'), 'http_302');
    assert.equal(requests.length, 1);
});

test('ownership is checked before modem mutations, even when passed a raw ID', async () => {
    error(await call('restart_modem', {proxy: ids.second, confirm: true}), 'proxy_not_found');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, '/account/proxies');
});

test('rotation returns verified success and preserves actual done status', async () => {
    assert.equal(data(await call('restart_modem', {proxy: ids.modem, confirm: true})).response.rotated, true);
    assert.equal(data(await call('get_rotation_status', {proxy: ids.modem})).response.state, 'done');
    data(await call('rotate_modem', {proxy_identifier: proxy.name, confirm: true}));
    assert.equal(requests.filter(request => request.path.endsWith('/restart')).length, 2);
});

test('HTTP 200 rotated:false is a tool failure, never reported queued or completed', async () => {
    overrides.set(`POST /modems/${ids.modem}/restart`, (_, res) => json(res, {rotated: false, ip: '203.0.113.8', message: 'IP unchanged'}));
    error(await call('restart_modem', {proxy: ids.modem, confirm: true}), 'rotation_failed');
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});

test('explicit rotation token uses the v3 token route without bearer credentials', async () => {
    data(await call('rotate_modem', {proxy_identifier: proxy.restartToken, confirm: true}));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, `/modems/rotate-modem-by-token/${proxy.restartToken}`);
    assert(!requests[0].headers.authorization);
});

test('invalid interval, missing confirmations and removed fire-and-forget inputs do not write', async () => {
    error(await call('set_rotation_interval', {proxy: ids.modem, interval_seconds: 30, confirm: true}));
    error(await call('cancel_modem', {proxy: ids.modem}));
    error(await call('replace_modem', {proxy: ids.modem}));
    error(await call('rotate_modem', {proxy_identifier: ids.modem, wait_for_completion: false, confirm: true}));
    assert.equal(requests.length, 0);
    data(await call('set_rotation_interval', {proxy: ids.modem, interval_seconds: 0, confirm: true}));
    assert.deepEqual(last(`/modems/${ids.modem}/set-rotation-interval`).body, {rotation_interval: 0});
});

test('password is explicitly supplied and generated locally when omitted', async () => {
    const result = data(await call('change_proxy_password', {proxy: ids.modem, confirm: true}));
    assert.equal(result.proxy_password.length, 32);
    assert.equal(last(`/modems/${ids.modem}/change-password`).body.proxy_password, result.proxy_password);
    data(await call('change_proxy_password', {proxy: ids.modem, proxy_password: 'chosen-fixture-password', confirm: true}));
    assert.equal(last(`/modems/${ids.modem}/change-password`).body.proxy_password, 'chosen-fixture-password');
});

test('metadata objects are serialized, per-server OS options are checked', async () => {
    data(await call('set_modem_metadata', {proxy: ids.modem, metadata: {job: 7}}));
    assert.deepEqual(last(`/modems/${ids.modem}/set-metadata`).body, {metadata: '{"job":7}'});
    error(await call('set_modem_os', {proxy: ids.modem, os: 'invented', confirm: true}), 'unsupported_os');
    assert(!last(`/modems/${ids.modem}/set-os`));
    data(await call('set_modem_os', {proxy: ids.modem, os: 'android', confirm: true}));
    assert.deepEqual(last(`/modems/${ids.modem}/set-os`).body, {os: 'android'});
});

test('cancellation preview sends dryRun:true; cancellation is an explicit separate call', async () => {
    data(await call('preview_modem_cancellation', {proxy: ids.modem}));
    assert.deepEqual(last(`/modems/${ids.modem}/cancel`).body, {dryRun: true});
    data(await call('cancel_modem', {proxy: ids.modem, reason: 'approved fixture', confirm: true}));
    assert.deepEqual(last(`/modems/${ids.modem}/cancel`).body, {reason: 'approved fixture'});
});

test('OpenVPN text is returned and HTML masquerading as config is rejected', async () => {
    assert.match(data(await call('get_openvpn_config', {proxy: ids.modem})).configuration, /<client>/);
    overrides.set(`GET /modems/${ids.modem}/openvpn`, (_, res) => {res.writeHead(200); res.end('<html>error</html>');});
    error(await call('get_openvpn_config', {proxy: ids.modem}), 'invalid_response');
});

test('pool tariff discovery uses existing public v1 catalog without exposing billing internals', async () => {
    const result = data(await call('list_pool_tariffs'));
    assert.equal(result.count, 1);
    assert.deepEqual(result.tariffs[0], {_id: ids.pool, name: 'Pool 10 GB', type: 'pool', currency: 'USD', price: 50, traffic_cap_gb: 10, duration_days: 60, pool_kind: 'any'});
    assert(!requests[0].headers.authorization);
    assert.equal(requests[0].path, '/api/v1/tariffs');
});

test('pool usage derives remaining cap minus used and keeps freshness', async () => {
    const key = data(await call('list_pool_keys')).keys[0];
    assert.equal(key.traffic_remaining_gb, 7.75);
    assert.equal(key.sync_stale_minutes, 2);
    assert.equal(key.traffic_synced_at, 1234);
});

test('pool stock and carrier routes require authentication', async () => {
    data(await call('get_pool_stock'));
    data(await call('get_pool_carriers', {country: 'us'}));
    assert.equal(requests[1].path, '/pool/stock/carriers/us');
    assert(requests.every(request => request.headers.authorization === 'Bearer fixture-token'));
});

test('pool topup requires a tariff and sends exact paid body with idempotency key', async () => {
    error(await call('topup_pool_key', {id: ids.key, confirm: true, idempotency_key: randomUUID()}));
    assert.equal(requests.length, 0);
    const key = randomUUID();
    data(await call('topup_pool_key', {id: ids.key, tariff_id: ids.pool, confirm: true, idempotency_key: key}));
    assert.deepEqual(last(`/account/pool-keys/${ids.key}/topup`).body, {tariff_id: ids.pool});
    assert.equal(requests[0].headers['idempotency-key'], key);
    data(await call('buy_pool_with_balance', {tariff_id: ids.pool, confirm: true, idempotency_key: randomUUID()}));
    assert.deepEqual(last('/payment/buy-pool-with-account-credit').body, {tariff_id: ids.pool});
    data(await call('cancel_pool_key', {id: ids.key, confirm: true, idempotency_key: randomUUID()}));
    assert.deepEqual(last(`/account/pool-keys/${ids.key}/cancel`).body, {});
});

test('pool advanced parameters pass through; ignored state and invalid strict mode are refused', async () => {
    const params = {country: 'US', pool: 'any', rotation: 'sticky', protocol: 'socks5', count: 3, carrier: 'fixture', city: 'chicago', sid: 'session', sessionPrefix: 'job', sessionMode: 'unique', failover: 'samecarrier', ipType: 'mobile', asn: '12345', isp: 'fixture', ttl: 600, strict: true};
    data(await call('build_pool_proxy_url', {id: ids.key, ...params}));
    assert.deepEqual(last(`/account/pool-keys/${ids.key}/proxy-url`).body, params);
    requests = [];
    error(await call('build_pool_proxy_url', {id: ids.key, strict: true, rotation: 'auto5'}), 'invalid_pool_parameters');
    error(await call('build_pool_proxy_url', {id: ids.key, state: 'CA'}));
    assert.equal(requests.length, 0);
});

test('saved pool configurations use correct owned routes and request names', async () => {
    data(await call('save_pool_session', {pool_key_id: ids.key, label: 'fixture', params: {country: 'us'}}));
    assert.deepEqual(last('/account/pool/saved').body, {poolKeyId: ids.key, label: 'fixture', params: {country: 'US', pool: 'any', protocol: 'http', count: 1}});
    data(await call('list_saved_pool_sessions'));
    data(await call('build_saved_pool_session_url', {id: ids.saved}));
    data(await call('delete_saved_pool_session', {id: ids.saved, confirm: true}));
    assert.equal(last(`/account/pool/saved/${ids.saved}/url`).method, 'POST');
    assert.equal(last(`/account/pool/saved/${ids.saved}`).method, 'DELETE');
});

test('closing pool sessions never defaults to close-all', async () => {
    error(await call('close_pool_session', {confirm: true}), 'session_selector_required');
    error(await call('close_pool_session', {session_key: 'one', all_sessions: true, confirm: true}), 'session_selector_required');
    assert.equal(requests.length, 0);
    data(await call('close_pool_session', {session_key: 'fixture/session', confirm: true}));
    assert.equal(requests[0].path, '/account/pool/sessions/fixture%2Fsession');
    data(await call('close_pool_session', {all_sessions: true, confirm: true}));
    assert.equal(requests[1].path, '/account/pool/sessions');
});

test('ticket filters/pagination and create fields match the backend', async () => {
    const result = data(await call('list_tickets', {status: 'pending', limit: 2, offset: 4}));
    assert.deepEqual(last('/tickets').query, {limit: '2', offset: '4', status: 'pending'});
    assert.equal(result.response.data.total, 7);
    data(await call('create_ticket', {subject: 'Fixture issue', message: 'Fixture details', category: 'technical', related_proxies: [ids.modem], confirm: true}));
    assert.deepEqual(last('/tickets').body, {subject: 'Fixture issue', message: 'Fixture details', category: 'technical', relatedProxies: [ids.modem]});
    data(await call('reply_to_ticket', {ticket_id: ids.ticket, message: 'Fixture reply', confirm: true}));
    assert.deepEqual(last(`/tickets/${ids.ticket}/reply`).body, {message: 'Fixture reply'});
    data(await call('archive_ticket', {ticket_id: ids.ticket, confirm: true}));
    assert.equal(last(`/tickets/${ids.ticket}/archive`).method, 'PUT');
});

test('read-only mode hides side-effecting GETs and mutations, permits pure POST previews', async () => {
    config.readOnly = true;
    const client = await connect();
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['buy_modems_with_balance', 'cancel_modem', 'get_crypto_balance', 'list_pool_keys', 'rotate_modem', 'test_modem', 'test_webhook']) assert(!names.includes(`coronium_${name}`), name);
    assert(names.includes('coronium_login'));
    data(await call('get_balance', {}, client));
    data(await call('get_renewal_quote', {modems: [{modem_id: ids.modem, days: 30}]}, client));
    data(await call('preview_modem_cancellation', {proxy: ids.modem}, client));
    data(await call('check_coupon', {code: 'SAVE'}, client));
    await assert.rejects(api.post('/modems/anything/restart'), error => error.details.code === 'read_only');
    await assert.rejects(api.get('/account/crypto-balance', undefined, {mutates: true}), error => error.details.code === 'read_only');
    assert(requests.filter(request => request.method === 'POST').every(request => request.path === '/payment/renewal-quote' || request.path === '/coupons/check' || request.body?.dryRun === true));
});

test('explicit logout prevents configured automatic login; explicit login restores it without leaking a token', async () => {
    config.login = 'fixture@example.invalid'; config.password = 'fixture-password';
    const client = await connect();
    data(await call('logout', {}, client));
    error(await call('get_balance', {}, client), 'not_authenticated');
    assert.equal(requests.length, 0);
    const result = await call('login', {}, client);
    assert.equal(data(result).authenticated, true);
    assert(!JSON.stringify(result).includes('login-fixture-token'));
    assert.equal(data(await call('check_token', {}, client)).valid, true);
    assert.equal(last('/account').headers.authorization, 'Bearer login-fixture-token');
});

test('automatic initial login is coalesced across concurrent reads', async () => {
    tokenStore.clear(); config.login = 'fixture@example.invalid'; config.password = 'fixture-password';
    const client = new CoroniumAPI();
    await Promise.all([client.get('/account'), client.get('/account')]);
    assert.equal(requests.filter(request => request.path === '/get-token').length, 1);
});

test('expired login token refreshes once for a read; explicit environment token never refreshes', async () => {
    config.login = 'fixture@example.invalid'; config.password = 'fixture-password';
    overrides.set('GET /account', (req, res) => req.headers.authorization === 'Bearer login-fixture-token' ? json(res, {ok: true}) : json(res, {error: 'jwt expired'}, 401));
    tokenStore.set('expired-login-token');
    await new CoroniumAPI().get('/account');
    assert.equal(requests.filter(request => request.path === '/get-token').length, 1);
    requests = []; tokenStore.set('fixture-token');
    await assert.rejects(new CoroniumAPI().get('/account'), error => error.details.status === 401);
    assert.equal(requests.length, 1);
});

test('pinned token cache uses authenticated encryption and restrictive permissions', async () => {
    config.tokenEncryptionKey = 'fixture-only-encryption-key';
    tokenStore.set('fixture-persisted-token');
    const file = join(home, '.coronium', 'token.enc');
    assert.match(readFileSync(file, 'utf8'), /^gcm:/);
    assert(!readFileSync(file, 'utf8').includes('fixture-persisted-token'));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, '.coronium')).mode & 0o777, 0o700);
    tokenStore.clear();
});

test('real stdio transport starts cleanly, accepts API_KEY alias and exposes valid structured results', async () => {
    const transport = new StdioClientTransport({command: process.execPath, args: ['dist/server.js'], cwd: process.cwd(), stderr: 'pipe', env: {
        PATH: process.env.PATH, HOME: home, DOTENV_CONFIG_PATH: join(home, 'absent.env'), CORONIUM_BASE_URL: config.baseUrl, CORONIUM_API_KEY: 'alias-fixture-token', CORONIUM_READ_ONLY: 'true',
    }});
    const client = new Client({name: 'stdio-contract', version: '1.0.0'});
    let stderr = ''; transport.stderr?.on('data', chunk => {stderr += chunk;});
    try {
        await client.connect(transport);
        assert.equal(client.getServerVersion().version, '2.0.0');
        assert.equal(data(await call('get_balance', {}, client)).account_credit.amount, 320);
        assert.equal(last('/account').headers.authorization, 'Bearer alias-fixture-token');
        assert.equal(stderr, '');
    } finally {await client.close();}
});

// Exercise the remaining forwarding routes through the MCP transport, not a
// mocked registerTool callback. Each route must preserve backend data.
for (const [name, args, method, path] of [
    ['get_account', {}, 'GET', '/account'], ['get_crypto_balance', {}, 'GET', '/account/crypto-balance'],
    ['get_credit_cards', {}, 'GET', '/account/card-list'], ['get_low_balance_threshold', {}, 'GET', '/account/low-balance-threshold'],
    ['set_low_balance_threshold', {thresholds: [100, 300]}, 'PUT', '/account/low-balance-threshold'],
    ['get_payments', {}, 'GET', '/account/payments'], ['get_subscriptions', {}, 'GET', '/account/subscriptions'],
    ['get_webhook', {}, 'GET', '/account/webhook'], ['set_webhook', {webhook_url: null, confirm: true}, 'PUT', '/account/webhook'],
    ['test_webhook', {confirm: true}, 'POST', '/account/webhook/test'], ['get_payment_status', {payment_id: 'pi_fixture'}, 'GET', '/payments/pi_fixture/status'],
    ['test_modem', {proxy: ids.modem}, 'POST', `/modems/${ids.modem}/test`], ['replace_modem', {proxy: ids.modem, confirm: true}, 'POST', `/modems/${ids.modem}/replace`],
    ['apply_modem_settings', {proxy: ids.modem, confirm: true}, 'POST', `/modems/${ids.modem}/apply-settings`],
    ['get_proxy_health', {}, 'GET', '/account/proxies/health'], ['get_p0f_options', {proxy: ids.modem}, 'GET', `/modems/${ids.modem}/p0f-options`],
    ['list_countries', {}, 'GET', '/countries'], ['list_pool_sessions', {}, 'GET', '/account/pool/sessions'],
    ['get_ticket', {ticket_id: ids.ticket}, 'GET', `/tickets/${ids.ticket}`],
]) test(`backend forwarding contract: ${name}`, async () => { data(await call(name, args)); assert.equal(last(path).method, method); });

test('legacy HTTP 200 payment refusal is a tool error with reconciliation details', async () => {
    overrides.set('POST /payment/buy-modems-with-crypto-balance', (_, res) => json(res, {error: 'Please pay or cancel current pending payment'}));
    const key = randomUUID();
    const result = await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', confirm: true, idempotency_key: key});
    const detail = error(result, 'upstream_rejected');
    assert.equal(detail.status, 200);
    assert.equal(detail.idempotency_key, key);
    assert.equal(detail.outcome, 'unknown');
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});

test('webhook delivery failure is not reported as a successful test', async () => {
    overrides.set('POST /account/webhook/test', (_, res) => json(res, {delivered: false, error: 'Connection failed', status_code: 502}));
    error(await call('test_webhook', {confirm: true}), 'upstream_rejected');
});
