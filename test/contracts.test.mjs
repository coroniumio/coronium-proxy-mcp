import assert from 'node:assert/strict';
import {after, afterEach, beforeEach, test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
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
const allRequests = [];
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
    allRequests.push(record);
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
    if (path === '/coupons/check') return json(res, {data: {discount: body.coupon_name === 'SAVE' ? '10%' : 0}});
    // unreviewedField stands for any field the backend adds that is not in the public fixture.
    if (/^\/modems\/[a-f0-9]{24}\/cancel$/.test(path)) return json(res, body?.dryRun === true ? {dryRun: true, cancelled: false, refundAmount: 12.5, hoursUsed: 3, unreviewedField: 4.2} : {cancelled: true, refundAmount: 12.5, refundedTo: 'account_credit', unreviewedField: 4.2});
    if (path === '/payment/renewal-quote') return json(res, {currency: 'USD', total_usd: 129, total_cents: 12900, line_items: body.modems.map(modem => ({modem_id: modem.modem_id, days: modem.days, usd: 129}))});
    if (path === '/account/pool-keys') return json(res, {data: [{_id: ids.key, traffic_cap_gb: 10, traffic_used_gb: 2.25, traffic_synced_at: 1234, sync_stale_minutes: 2, status: 'active'}]});
    if (path === '/tickets' && req.method === 'GET') return json(res, {data: {tickets: [{_id: ids.ticket, subject: 'Fixture', status: 'pending'}], total: 7, limit: Number(record.query.limit), offset: Number(record.query.offset)}});
    if (path.endsWith('/p0f-options')) return json(res, {data: {supported: true, options: ['linux', 'android'], current: ''}});
    if (path.endsWith('/rotation-status')) return json(res, {state: 'done', ext_ip: '203.0.113.9', elapsedMs: 200});
    if (path.endsWith('/restart')) return json(res, {result: 'ok', rotated: true, ip: '203.0.113.9'});
    if (path.startsWith('/modems/rotate-modem-by-token/')) return json(res, {result: 'ok', ext_ip: '203.0.113.9', new_ip: '203.0.113.9'});
    if (path.endsWith('/openvpn')) {res.writeHead(200, {'Content-Type': 'application/octet-stream'}); return res.end('<client>\nclient\nremote fixture.invalid 1194\n</client>');}
    if (path === '/account/webhook/test') return json(res, {delivered: true, status_code: 204});
    // Modem buy and renew lanes answer with the live 200 shape: charged_usd and the delivered proxies.
    if (/^\/payment\/(?:buy|renew)-(?:with-account-credit|modems-with-crypto-balance)$/.test(path)) {
        const count = body.modemCount ?? body.modems.length;
        const charged = Math.round(129 * count * (body.coupon ? 0.9 : 1) * 100) / 100;
        const delivered = Array.from({length: count}, (_, index) => ({_id: String(index).padStart(24, 'b'), proxy_login: 'fixture'}));
        return json(res, {result: 'ok', charged_usd: charged, currency: 'USD', data: delivered}, 200, {'x-request-id': 'fixture-request', 'x-idempotency-replay': 'false'});
    }
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
const {redact, normalizeErrorCode} = await import('../dist/errors.js');
const {resolveBaseUrl, DEFAULT_BASE_URL} = await import('../dist/config.js');
const {toolDefinitions} = await import('../dist/tool.js');
const {DIRECTORY_TOOLS, BUYER_TOOLS} = await import('../dist/profiles.js');
const routeFixture = JSON.parse(readFileSync(new URL('./fixtures/v3-routes.json', import.meta.url), 'utf8'));

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
function error(result, code) {assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined); const text = result.content[0].text; const detail = text.startsWith('{') ? JSON.parse(text).error : {message: text}; if (code) assert.equal(detail?.code, code); return detail;}
function last(path) {return requests.filter(request => request.path === path).at(-1);}
beforeEach(() => {requests = []; overrides = new Map(); config.readOnly = false; config.profile = 'full'; config.spendingEnabled = true; config.loginToolEnabled = false; config.login = undefined; config.password = undefined; config.autoLoginOn401 = true; config.tokenEncryptionKey = undefined; config.timeoutMs = 30_000; config.actionTimeoutMs = 180_000; tokenStore.set('fixture-token');});
afterEach(async () => {await Promise.all(connections.splice(0).map(async ({client, server}) => {await client.close(); await server.close();}));});
after(async () => {await new Promise(resolve => backend.close(resolve)); rmSync(home, {recursive: true, force: true});});

test('MCP initialization, all tool schemas, annotations, resources and prompts', async () => {
    const client = await connect();
    assert.equal(client.getServerVersion().version, '2.2.1');
    const {tools} = await client.listTools();
    assert.equal(tools.length, 65);
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
    for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object', tool.name);
        assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
        assert.equal(tool.outputSchema.type, 'object', tool.name);
        assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
        assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
        assert.equal(typeof tool.annotations.title, 'string');
        assert.equal(tool.annotations.openWorldHint, true);
    }
    const cancellation = tools.find(tool => tool.name === 'coronium_cancel_modem');
    assert.match(cancellation.description, /IMMEDIATELY/);
    assert.equal(cancellation.annotations.destructiveHint, true);
    assert(cancellation.inputSchema.required.includes('confirm'));
    assert.equal((await client.listResources()).resources.length, 1);
    assert.match((await client.readResource({uri: 'coronium://guide'})).contents[0].text, /Never repeat a write automatically/);
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
    const result = data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 2, funding_source: 'account_credit', country_code: 'us', coupon: 'SAVE', metadata: {job: 'fixture'}, want_p0f: false, expected_total_usd: 232.2, confirm: true, idempotency_key: key}));
    const request = last('/payment/buy-with-account-credit');
    assert.deepEqual(request.body, {tariff_id: ids.tariff, modemCount: 2, max_total_usd: 232.2, coupon: {coupon_name: 'SAVE'}, metadata: '{"job":"fixture"}'});
    assert.equal(request.headers['idempotency-key'], key);
    assert.equal(result.response.charged_usd, 232.2);
    assert.deepEqual(result.charge, {approved_usd: 232.2, charged_usd: 232.2, within_approval: true});
    assert.equal(result.request.idempotency_key, key);
    assert.equal(result.request.request_id, 'fixture-request');
    assert.equal(result.request.replayed, false);
    assert.equal(result.delivery.delivered_count, 2);
    assert.equal(result.delivery.delivery_verified, true);
    assert.match(result.delivery.next_step, /get_payments/);
});

test('a charge above the approved total, a short delivery and a queued payment are reported, never hidden', async () => {
    const base = {tariff_id: ids.tariff, quantity: 2, funding_source: 'account_credit', expected_total_usd: 258, confirm: true};
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {result: 'ok', charged_usd: 300, currency: 'USD', data: [{_id: ids.second}]}));
    const over = data(await call('buy_modems_with_balance', {...base, idempotency_key: randomUUID()}));
    assert.deepEqual(over.charge, {approved_usd: 258, charged_usd: 300, within_approval: false});
    assert.equal(over.delivery.delivered_count, 1);
    assert.equal(over.delivery.delivery_verified, false);
    overrides.set('POST /payment/buy-modems-with-crypto-balance', (_, res) => json(res, {message: 'Payment is processing', paymentId: 'fixture-queued'}, 202));
    const queued = data(await call('buy_modems_with_balance', {...base, funding_source: 'btc', idempotency_key: randomUUID()}));
    assert.deepEqual(queued.charge, {approved_usd: 258, charged_usd: null, within_approval: null});
    assert.equal(queued.delivery.delivery_verified, false);
    assert.equal(queued.response.paymentId, 'fixture-queued');
    assert.equal(queued.payment_id, 'fixture-queued');
    assert.equal(queued.pending, true);
    assert.match(queued.next_step, /coronium_get_payment_status with payment_id fixture-queued/);
    assert.match(queued.delivery.next_step, /Never buy again/);
});

test('BTC purchase selects BTC route, not USD credit', async () => {
    data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}));
    assert(last('/payment/buy-modems-with-crypto-balance'));
    assert(!last('/payment/buy-with-account-credit'));
});

test('buy rejects missing authorization, unsupported inputs and key before HTTP', async () => {
    const valid = {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()};
    for (const args of [{...valid, funding_source: undefined}, {...valid, expected_total_usd: undefined}, {...valid, confirm: false}, {...valid, confirm: undefined}, {...valid, idempotency_key: undefined}, {...valid, funding_source: 'usdt'}, {...valid, unexpected: 'ignored?'}, {...valid, quantity: 0}]) error(await call('buy_modems_with_balance', args));
    assert.equal(requests.length, 0);
});

test('country and quantity preflight failures do not spend', async () => {
    const args = {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 2000, confirm: true, idempotency_key: randomUUID()};
    error(await call('buy_modems_with_balance', {...args, country_code: 'PL'}), 'tariff_unavailable');
    error(await call('buy_modems_with_balance', {...args, quantity: 9}), 'insufficient_stock');
    assert(requests.every(request => request.method === 'GET'));
});

test('renewal quote and checkout use modem IDs/days, normalize IDs and omit tariff', async () => {
    const modems = [{modem_id: ids.second.toUpperCase(), days: 30}];
    const result = data(await call('renew_modems_with_balance', {modems, coupon: 'SAVE', funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}));
    assert.equal(result.quote_before_submission.total_usd, 129);
    assert.deepEqual(last('/payment/renew-with-account-credit').body, {modems: [{modem_id: ids.second, days: 30}], max_total_usd: 129, coupon: {coupon_name: 'SAVE'}});
    assert(!('tariff_id' in last('/payment/renew-with-account-credit').body));
    data(await call('renew_modems_with_balance', {modems, funding_source: 'btc', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}));
    assert(last('/payment/renew-modems-with-crypto-balance'));
});

test('partial ownership quote and duplicate modem IDs block renewal', async () => {
    const args = {modems: [{modem_id: ids.modem, days: 30}, {modem_id: ids.second, days: 7}], funding_source: 'account_credit', expected_total_usd: 500, confirm: true, idempotency_key: randomUUID()};
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
    const result = await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()});
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
    const done = data(await call('restart_modem', {proxy: ids.modem, confirm: true}));
    assert.equal(done.state, 'done');
    assert.equal(done.ip, '203.0.113.9');
    assert.equal(data(await call('get_rotation_status', {proxy: ids.modem})).response.state, 'done');
    data(await call('rotate_modem', {proxy_identifier: proxy.name, confirm: true}));
    assert.equal(requests.filter(request => request.path.endsWith('/restart')).length, 2);
});

test('HTTP 200 rotated:false is state unchanged, not an error and not a success', async () => {
    overrides.set(`POST /modems/${ids.modem}/restart`, (_, res) => json(res, {result: 'ok', rotated: false, ip: '203.0.113.8', message: 'IP unchanged'}));
    const result = data(await call('restart_modem', {proxy: ids.modem, confirm: true}));
    assert.equal(result.state, 'unchanged');
    assert.match(result.next_step, /60 seconds/);
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});

test('explicit rotation token uses the v3 token route without bearer credentials', async () => {
    // The token route's success body has no rotated field (critique B2).
    const result = data(await call('rotate_modem', {proxy_identifier: proxy.restartToken, confirm: true}));
    assert.equal(result.state, 'done');
    assert.equal(result.ip, '203.0.113.9');
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
    const preview = data(await call('preview_modem_cancellation', {proxy: ids.modem}));
    assert.deepEqual(last(`/modems/${ids.modem}/cancel`).body, {dryRun: true});
    // Only documented customer fields leave the tool.
    assert.deepEqual(preview.response, {dryRun: true, cancelled: false, refundAmount: 12.5, hoursUsed: 3});
    const cancelled = data(await call('cancel_modem', {proxy: ids.modem, reason: 'approved fixture', min_refund_usd: 12.5, confirm: true}));
    assert.equal(cancelled.preview_before_submission.refundAmount, 12.5);
    assert.deepEqual(cancelled.response, {cancelled: true, refundAmount: 12.5, refundedTo: 'account_credit'});
    assert.doesNotMatch(JSON.stringify(cancelled), /unreviewedField/);
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
    error(await call('topup_pool_key', {id: ids.key, expected_total_usd: 50, confirm: true, idempotency_key: randomUUID()}));
    assert.equal(requests.length, 0);
    const key = randomUUID();
    data(await call('topup_pool_key', {id: ids.key, tariff_id: ids.pool, expected_total_usd: 50, confirm: true, idempotency_key: key}));
    assert.deepEqual(last(`/account/pool-keys/${ids.key}/topup`).body, {tariff_id: ids.pool});
    assert.equal(last(`/account/pool-keys/${ids.key}/topup`).headers['idempotency-key'], key);
    error(await call('buy_pool_with_balance', {tariff_id: ids.pool, expected_total_usd: 40, confirm: true, idempotency_key: randomUUID()}), 'price_changed');
    assert(!last('/payment/buy-pool-with-account-credit'));
    data(await call('buy_pool_with_balance', {tariff_id: ids.pool, expected_total_usd: 50, confirm: true, idempotency_key: randomUUID()}));
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
    config.readOnly = true; config.profile = 'read-only';
    const client = await connect();
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['buy_modems_with_balance', 'cancel_modem', 'get_crypto_balance', 'list_pool_keys', 'rotate_modem', 'test_modem', 'test_webhook']) assert(!names.includes(`coronium_${name}`), name);
    assert(!names.includes('coronium_login'));
    data(await call('get_balance', {}, client));
    data(await call('get_renewal_quote', {modems: [{modem_id: ids.modem, days: 30}]}, client));
    data(await call('preview_modem_cancellation', {proxy: ids.modem}, client));
    data(await call('check_coupon', {code: 'SAVE'}, client));
    await assert.rejects(api.post('/modems/anything/restart'), error => error.details.code === 'read_only');
    await assert.rejects(api.get('/account/crypto-balance', undefined, {mutates: true}), error => error.details.code === 'read_only');
    assert(requests.filter(request => request.method === 'POST').every(request => request.path === '/payment/renewal-quote' || request.path === '/coupons/check' || request.body?.dryRun === true));
});

test('explicit logout prevents configured automatic login; explicit login restores it without leaking a token', async () => {
    config.login = 'fixture@example.invalid'; config.password = 'fixture-password'; config.loginToolEnabled = true;
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
        assert.equal(client.getServerVersion().version, '2.2.1');
        assert.equal(data(await call('get_balance', {}, client)).account_credit.amount, 320);
        assert.equal(last('/account').headers.authorization, 'Bearer alias-fixture-token');
        assert.equal(stderr, '');
    } finally {await client.close();}
});

test('a .env in the working directory cannot enable spending or redirect the token', async () => {
    const project = mkdtempSync(join(tmpdir(), 'coronium-mcp-cwd-'));
    writeFileSync(join(project, '.env'), 'CORONIUM_ENABLE_SPENDING=1\nCORONIUM_BASE_URL=https://redirect.example.invalid/api/v3\nCORONIUM_API_TOKEN=dotenv-fixture-token\n');
    // No CORONIUM_BASE_URL in the host environment: get_capabilities makes no
    // network request, so nothing reaches production or the redirect host.
    const transport = new StdioClientTransport({command: process.execPath, args: [resolve('dist/server.js')], cwd: project, stderr: 'pipe', env: {PATH: process.env.PATH, HOME: home}});
    const client = new Client({name: 'dotenv-contract', version: '1.0.0'});
    try {
        await client.connect(transport);
        const names = (await client.listTools()).tools.map(tool => tool.name);
        for (const name of MONEY_TOOLS) assert(!names.includes(name), name);
        const capabilities = data(await call('get_capabilities', {}, client));
        assert.equal(capabilities.spending_enabled, false);
        assert.equal(capabilities.api_base_url, 'https://api.coronium.io/api/v3');
    } finally {
        await client.close();
        rmSync(project, {recursive: true, force: true});
    }
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
    const result = await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', expected_total_usd: 129, confirm: true, idempotency_key: key});
    const detail = error(result, 'upstream_rejected');
    assert.equal(detail.status, 200);
    assert.equal(detail.idempotency_key, key);
    assert.equal(detail.outcome, 'unknown');
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});

test('webhook delivery failure is a normal ok:false diagnostic, not a success or an unknown outcome', async () => {
    overrides.set('POST /account/webhook/test', (_, res) => json(res, {delivered: false, error: 'Connection failed', status_code: 502}));
    const result = data(await call('test_webhook', {confirm: true}));
    assert.equal(result.ok, false);
    assert.equal(result.response.error, 'Connection failed');
});

// ---- 2.1.0: profiles, spending gate, route fixture, rotation and error contracts ----

async function toolNames(profile, spendingEnabled) {
    config.profile = profile; config.spendingEnabled = spendingEnabled; config.readOnly = profile === 'read-only';
    const client = await connect();
    return (await client.listTools()).tools.map(tool => tool.name).sort();
}
function expectedProfile(name) {return JSON.parse(readFileSync(new URL(`./profiles/${name}.json`, import.meta.url), 'utf8'));}
const MONEY_TOOLS = ['buy_modems_with_balance', 'renew_modems_with_balance', 'buy_pool_with_balance', 'topup_pool_key', 'cancel_modem', 'cancel_pool_key'].map(name => `coronium_${name}`);

test('each profile registers exactly its checked-in tool list', async () => {
    assert.deepEqual(await toolNames('directory', false), expectedProfile('directory'));
    assert.deepEqual(await toolNames('directory', true), expectedProfile('directory'));
    assert.deepEqual(await toolNames('full', false), expectedProfile('full'));
    assert.deepEqual(await toolNames('full', true), expectedProfile('full-spending'));
    assert.deepEqual(await toolNames('read-only', true), expectedProfile('read-only'));
    assert.deepEqual(await toolNames('buyer', false), expectedProfile('buyer'));
    assert.deepEqual(await toolNames('buyer', true), expectedProfile('buyer-spending'));
    assert.deepEqual(expectedProfile('directory'), [...DIRECTORY_TOOLS].sort());
    assert.deepEqual(expectedProfile('buyer-spending'), [...BUYER_TOOLS].sort());
});

// ---- 2.2.0: login opt-in, buyer profile, stable order, recovery hints, exact-total check ----

test('the password login tool is off in every profile unless CORONIUM_ENABLE_LOGIN_TOOL is set, and never in directory or buyer', async () => {
    for (const profile of ['full', 'buyer', 'directory', 'read-only']) {
        const names = await toolNames(profile, true);
        assert(!names.includes('coronium_login') && !names.includes('coronium_logout'), profile);
    }
    config.loginToolEnabled = true;
    for (const profile of ['full', 'read-only']) assert((await toolNames(profile, true)).includes('coronium_login'), profile);
    for (const profile of ['buyer', 'directory']) assert(!(await toolNames(profile, true)).includes('coronium_login'), profile);
});

test('tools/list order is alphabetical and identical across sessions', async () => {
    for (const profile of ['full', 'buyer', 'directory', 'read-only']) {
        config.profile = profile; config.readOnly = profile === 'read-only';
        const first = (await (await connect()).listTools()).tools.map(tool => tool.name);
        const second = (await (await connect()).listTools()).tools.map(tool => tool.name);
        assert.deepEqual(first, [...first].sort(), profile);
        assert.deepEqual(first, second, profile);
    }
});

test('every tool has a title, both hints and an output schema in every profile', async () => {
    config.loginToolEnabled = true;
    for (const profile of ['full', 'buyer', 'directory', 'read-only']) {
        config.profile = profile; config.readOnly = profile === 'read-only';
        for (const tool of (await (await connect()).listTools()).tools) {
            assert.equal(typeof tool.title, 'string', tool.name);
            assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
            assert.equal(typeof tool.annotations.destructiveHint, 'boolean', tool.name);
            assert.equal(tool.outputSchema.type, 'object', tool.name);
            assert.doesNotMatch(tool.description, /\btrial\b|\bfree (proxy|proxies|plan|credit)|usdt (spend|pay)|stripe pay|x402|\bSPT\b/i, tool.name);
        }
    }
});

test('buyer profile: about ten tools, token-only auth, and with spending off it cannot spend', async () => {
    const names = await toolNames('buyer', false);
    assert(names.length >= 9 && names.length <= 14, String(names.length));
    for (const name of MONEY_TOOLS) assert(!names.includes(name), name);
    const client = await connect();
    const checkToken = (await client.listTools()).tools.find(tool => tool.name === 'coronium_check_token');
    assert.equal(checkToken, undefined);
    const result = await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}, client);
    assert.equal(result.isError, true);
    await assert.rejects(new CoroniumAPI().payment('/payment/buy-with-account-credit', {}, randomUUID()), failure => failure.details.code === 'spending_disabled');
    assert(!requests.some(request => request.path.startsWith('/payment/')));
    const capabilities = data(await call('get_capabilities', {}, client));
    assert.equal(capabilities.profile, 'buyer');
    assert.equal(capabilities.spending_enabled, false);
    assert.equal(capabilities.login_tool_enabled, false);
});

test('buyer profile with spending on: quote then buy with the quoted total', async () => {
    config.profile = 'buyer'; config.spendingEnabled = true;
    const client = await connect();
    const quote = data(await call('quote_purchase', {tariff_id: ids.tariff, quantity: 2}, client));
    assert.equal(quote.total_usd, 258);
    assert.equal(quote.expected_total_usd, 258);
    assert.equal(quote.plan.stock, 8);
    assert(!requests.some(request => request.path.startsWith('/payment/')));
    data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 2, funding_source: 'account_credit', expected_total_usd: quote.total_usd, confirm: true, idempotency_key: randomUUID()}, client));
    assert.equal(requests.filter(request => request.path === '/payment/buy-with-account-credit').length, 1);
    const guide = (await client.readResource({uri: 'coronium://guide'})).contents[0].text;
    assert.match(guide, /quote_purchase/);
    assert.doesNotMatch(guide, /cancel_modem|renew_modems/);
});

test('errors carry isError:true and a recovery_hint; out of stock lists what is in stock now', async () => {
    const lowStock = error(await call('quote_purchase', {tariff_id: ids.tariff, quantity: 50}), 'insufficient_stock');
    assert.match(lowStock.recovery_hint, /Not enough stock for 50 of US/);
    assert.match(lowStock.recovery_hint, /coronium_list_free_modems/);
    assert.equal(lowStock.details.available, 8);
    const unknown = error(await call('quote_purchase', {tariff_id: ids.second, quantity: 1}), 'tariff_unavailable');
    assert.match(unknown.recovery_hint, /In stock now: .*US, \$129, 8 in stock/);
    tokenStore.clear();
    const auth = error(await call('get_balance'), 'not_authenticated');
    assert.match(auth.recovery_hint, /CORONIUM_API_TOKEN/);
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE', required: 129, available: 3}, 402));
    tokenStore.set('fixture-token');
    const broke = error(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}), 'insufficient_balance');
    assert.match(broke.recovery_hint, /dashboard\.coronium\.io/);
});

test('directory profile: no money, login, OS or wallet tools, no token argument, no spending words in the guide', async () => {
    const names = await toolNames('directory', true);
    assert(names.length >= 18 && names.length <= 24, String(names.length));
    for (const name of [...MONEY_TOOLS, 'coronium_login', 'coronium_logout', 'coronium_get_p0f_options', 'coronium_set_modem_os', 'coronium_get_crypto_balance', 'coronium_set_webhook', 'coronium_get_credit_cards']) assert(!names.includes(name), name);
    const client = await connect();
    const checkToken = (await client.listTools()).tools.find(tool => tool.name === 'coronium_check_token');
    assert.deepEqual(Object.keys(checkToken.inputSchema.properties ?? {}), []);
    error(await call('check_token', {token: 'pasted-secret'}, client));
    const guide = (await client.readResource({uri: 'coronium://guide'})).contents[0].text;
    assert.doesNotMatch(guide, /buy_|renew_modems|topup|idempotency|expected_total|min_refund/i);
    assert.match(guide, /dashboard\.coronium\.io/);
    const capabilities = data(await call('get_capabilities', {}, client));
    assert.equal(capabilities.profile, 'directory');
    assert.equal(capabilities.spending_enabled, false);
    assert.deepEqual(capabilities.modem_funding_sources, []);
});

test('spending stays off unless the full profile and CORONIUM_ENABLE_SPENDING are both set; the transport refuses too', async () => {
    const names = await toolNames('full', false);
    for (const name of MONEY_TOOLS) assert(!names.includes(name), name);
    assert(names.includes('coronium_preview_modem_cancellation'));
    for (const [profile, enabled] of [['full', false], ['directory', true], ['read-only', true]]) {
        config.profile = profile; config.spendingEnabled = enabled;
        await assert.rejects(new CoroniumAPI().payment('/payment/buy-with-account-credit', {}, randomUUID()), failure => failure.details.code === 'spending_disabled');
    }
    assert.equal(requests.length, 0);
});

test('every tool route exists in the shared public route fixture', () => {
    const known = new Set([...routeFixture.routes, ...routeFixture.non_v3_routes].map(route => `${route.method} ${route.path}`));
    assert.equal(routeFixture.routes.length, 72);
    assert(toolDefinitions.size >= 66);
    for (const tool of toolDefinitions.values()) {
        if (tool.routes.length === 0) assert(['coronium_logout', 'coronium_get_capabilities'].includes(tool.name), tool.name);
        for (const route of tool.routes) assert(known.has(route), `${tool.name}: ${route}`);
    }
});

test('route fixture holds only method, path, auth and public field shapes', () => {
    const text = readFileSync(new URL('./fixtures/v3-routes.json', import.meta.url), 'utf8');
    assert.doesNotMatch(text, /defect|farmer|koef|ts-api|home\/projects|\.(js|ts):\d+|internalNotes|escalat|handler|middleware|side_effect/i);
    for (const route of routeFixture.routes) {
        assert.deepEqual(Object.keys(route).sort(), ['auth', 'body', 'method', 'path', 'path_params', 'query', 'responses']);
        assert(['public', 'bearer'].includes(route.auth));
    }
});

test('base URL is pinned to production when CORONIUM_BASE_URL is unset or empty', () => {
    assert.equal(DEFAULT_BASE_URL, 'https://api.coronium.io/api/v3');
    assert.equal(resolveBaseUrl(undefined), DEFAULT_BASE_URL);
    assert.equal(resolveBaseUrl('  '), DEFAULT_BASE_URL);
    assert.throws(() => resolveBaseUrl('http://example.invalid/api/v3'));
    assert.throws(() => resolveBaseUrl('https://user:pass@example.invalid/api/v3'));
});

test('pending rotations (202 Node, PocketProxy accepted) are state rotating, never rotation_failed', async () => {
    overrides.set(`POST /modems/${ids.modem}/restart`, (_, res) => json(res, {result: 'ok', rotated: false, pending: true, state: 'rotating', status_url: '/status', retry_after_seconds: 15}, 202));
    const pending = data(await call('restart_modem', {proxy: ids.modem, confirm: true}));
    assert.equal(pending.state, 'rotating');
    assert.equal(pending.retry_after_seconds, 15);
    assert.match(pending.next_step, /get_rotation_status/);
    overrides.set(`GET /modems/rotate-modem-by-token/${proxy.restartToken}`, (_, res) => json(res, {result: 'ok', accepted: true, rotated: false, pending: true}, 202));
    assert.equal(data(await call('rotate_modem', {proxy_identifier: proxy.restartToken, confirm: true})).state, 'rotating');
});

test('rotation cooldown 429 is rotation_cooldown with retry_after_seconds, whatever code the envelope wrote', async () => {
    overrides.set(`POST /modems/${ids.modem}/restart`, (_, res) => json(res, {error: 'Please wait 42 more seconds to rotate.', code: 'internal_error', retry_after_seconds: 42}, 429, {'retry-after': '42'}));
    let detail = error(await call('restart_modem', {proxy: ids.modem, confirm: true}), 'rotation_cooldown');
    assert.equal(detail.retry_after_seconds, 42);
    assert.equal(detail.backend_code, 'internal_error');
    overrides.set(`POST /modems/${ids.modem}/restart`, (_, res) => json(res, {error: 'Please wait 17 more seconds to rotate...', code: 'modem_rotation_in_progress'}, 429));
    detail = error(await call('restart_modem', {proxy: ids.modem, confirm: true}), 'rotation_cooldown');
    assert.equal(detail.retry_after_seconds, 17);
    assert.equal(requests.filter(request => request.method === 'POST').length, 2);
});

test('a failed token rotation (502, envelope says in progress) is rotation_failed', async () => {
    overrides.set(`GET /modems/rotate-modem-by-token/${proxy.restartToken}`, (_, res) => json(res, {result: 'error', error: 'Rotation failed', code: 'modem_rotation_in_progress', ext_ip: '203.0.113.8'}, 502));
    const detail = error(await call('rotate_modem', {proxy_identifier: proxy.restartToken, confirm: true}), 'rotation_failed');
    assert.equal(detail.suggested_action, 'check_rotation_status');
});

test('uppercase backend codes are normalised and the original kept', async () => {
    assert.equal(normalizeErrorCode('PAYMENT_IN_PROGRESS'), 'payment_in_progress');
    assert.equal(normalizeErrorCode('CANCEL_UNSUPPORTED'), 'cancel_unsupported');
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {error: 'Another payment is in progress.', code: 'PAYMENT_IN_PROGRESS', retry_after_seconds: 5}, 429, {'retry-after': '5'}));
    const detail = error(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}), 'payment_in_progress');
    assert.equal(detail.backend_code, 'PAYMENT_IN_PROGRESS');
    assert.equal(detail.retry_after_seconds, 5);
});

test('a synchronously refunded out-of-stock purchase is refunded_not_charged, not unknown', async () => {
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {error: 'Out of stock', code: 'no_stock', refunded: true, refund_amount: 129, balance_after: 320, retry_after_seconds: 300}, 503));
    const detail = error(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}), 'no_stock');
    assert.equal(detail.outcome, 'refunded_not_charged');
    assert.equal(detail.retry_after_seconds, 300);
});

test('a current price that differs from the approved total, or an unusable coupon, refuses before any payment call', async () => {
    const base = {tariff_id: ids.tariff, quantity: 2, funding_source: 'account_credit', confirm: true, idempotency_key: randomUUID()};
    error(await call('buy_modems_with_balance', {...base, expected_total_usd: 200}), 'price_changed');
    error(await call('buy_modems_with_balance', {...base, expected_total_usd: 300}), 'price_changed');
    error(await call('buy_modems_with_balance', {...base, coupon: 'EXPIRED', expected_total_usd: 258}), 'coupon_invalid');
    overrides.set('POST /payment/renewal-quote', (_, res, record) => json(res, {total_usd: 150, line_items: record.body.modems.map(modem => ({...modem, usd: 150}))}));
    error(await call('renew_modems_with_balance', {modems: [{modem_id: ids.modem, days: 30}], funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}), 'price_changed');
    overrides.set('POST /payment/renewal-quote', (_, res) => json(res, {total_usd: 20, line_items: [{modem_id: ids.modem, days: 7}]}));
    error(await call('get_renewal_quote', {modems: [{modem_id: ids.modem, days: 30}]}), 'incomplete_renewal_quote');
    assert(!requests.some(request => request.path.startsWith('/payment/') && request.path !== '/payment/renewal-quote'));
});

test('cancel re-runs the preview and refuses below the approved refund floor; concurrent replaces send one call', async () => {
    error(await call('cancel_modem', {proxy: ids.modem, min_refund_usd: 20, confirm: true}), 'refund_changed');
    assert.deepEqual(requests.filter(request => request.path.endsWith('/cancel')).map(request => request.body), [{dryRun: true}]);
    const cancel = (await connect()).listTools().then(result => result.tools.find(tool => tool.name === 'coronium_cancel_modem'));
    assert.match((await cancel).description, /NOT a way to stop auto-renew/);
    requests = [];
    overrides.set(`POST /modems/${ids.modem}/replace`, (_, res) => setTimeout(() => json(res, {result: 'ok', newModemId: ids.second}), 50));
    const client = await connect();
    const results = await Promise.all([call('replace_modem', {proxy: ids.modem, confirm: true}, client), call('replace_modem', {proxy: ids.modem, confirm: true}, client)]);
    assert.equal(results.filter(result => result.isError).length, 1);
    assert.equal(error(results.find(result => result.isError)).code, 'modem_action_in_progress');
    assert.equal(requests.filter(request => request.path.endsWith('/replace')).length, 1);
});

test('separate HTTP and SOCKS5 logins produce distinct URLs from proxyEndpoints', async () => {
    const separate = {...proxy, proxyEndpoints: {credentials: 'separate-protocol-v1', http: {host: '198.51.100.4', port: 8001, username: 'h-user', password: 'h-pass'}, socks5: {host: '198.51.100.4', port: 9001, username: 's-user', password: 's-pass'}}};
    overrides.set('GET /account/proxies', (_, res) => json(res, {data: [separate]}));
    const result = data(await call('get_proxy', {proxy: proxy.name})).proxy;
    assert.equal(result.http_url, 'http://h-user:h-pass@198.51.100.4:8001');
    assert.equal(result.socks5_url, 'socks5://s-user:s-pass@198.51.100.4:9001');
});

test('ticket responses never contain support-internal fields', async () => {
    const ticket = {_id: ids.ticket, subject: 'Fixture', status: 'open', internalNotes: [{text: 'secret-note'}], escalated: true, escalationReason: 'x', escalatedAt: 1};
    overrides.set('GET /tickets', (_, res) => json(res, {data: {tickets: [ticket], total: 1, limit: 50, offset: 0}}));
    overrides.set(`GET /tickets/${ids.ticket}`, (_, res) => json(res, {data: ticket}));
    overrides.set('POST /tickets', (_, res) => json(res, {data: ticket}, 201));
    for (const result of [await call('list_tickets'), await call('get_ticket', {ticket_id: ids.ticket}), await call('create_ticket', {subject: 'Fixture', message: 'Fixture body', confirm: true})]) {
        const text = JSON.stringify(data(result));
        assert.doesNotMatch(text, /internalNotes|escalat|secret-note/);
        assert.match(text, /Fixture/);
    }
});

test('test_modem reports a 200 error body as ok:false, success as ok:true', async () => {
    overrides.set(`POST /modems/${ids.modem}/test`, (_, res) => json(res, {error: 'Modem unavailable!', requestTime: 3}));
    assert.equal(data(await call('test_modem', {proxy: ids.modem})).ok, false);
    overrides.set(`POST /modems/${ids.modem}/test`, (_, res) => json(res, {data: {error: '', extIp: '203.0.113.9'}}, 201));
    assert.equal(data(await call('test_modem', {proxy: ids.modem})).ok, true);
});

test('webhook tools: set warns about automatic replacement; delete and secret rotation use the real routes', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    assert.match(tools.find(tool => tool.name === 'coronium_set_webhook').description, /automatic replacement of dead proxies/);
    assert.match(tools.find(tool => tool.name === 'coronium_rotate_webhook_secret').description, /returned once/);
    error(await call('delete_webhook', {}, client));
    assert.equal(requests.length, 0);
    data(await call('delete_webhook', {confirm: true}, client));
    data(await call('rotate_webhook_secret', {confirm: true}, client));
    assert.equal(last('/account/webhook').method, 'DELETE');
    assert.equal(last('/account/webhook/secret/rotate').method, 'POST');
});

test('login accepts a non-email account name', async () => {
    config.loginToolEnabled = true;
    data(await call('login', {login: 'reseller_account', password: 'fixture-password'}));
    assert.deepEqual(last('/get-token').body, {login: 'reseller_account', password: 'fixture-password'});
});

for (const [name, args, method, path] of [
    ['set_white_list', {proxy: ids.modem, white_list: ['198.51.100.7'], confirm: true}, 'PUT', `/modems/${ids.modem}/set-white-list`],
    ['get_usage', {proxy: ids.modem, days: 7}, 'GET', `/modems/${ids.modem}/usage`],
    ['start_speed_test', {proxy: ids.modem, confirm: true}, 'POST', `/modems/${ids.modem}/speed-test`],
    ['get_speed_test', {proxy: ids.modem}, 'GET', `/modems/${ids.modem}/speed-test`],
    ['revoke_openvpn', {proxy: ids.modem, confirm: true}, 'POST', `/modems/${ids.modem}/openvpn/revoke`],
]) test(`Node route forwarding: ${name}`, async () => { data(await call(name, args)); assert.equal(last(path).method, method); });

test('public files carry no internal details, long dashes or non-public contact addresses', () => {
    const files = ['README.md', 'CHANGELOG.md', 'llms.txt', 'AGENTS.md', 'docs/backend-contract.md', '.env.example', 'package.json', 'test/fixtures/v3-routes.json', ...['api-client', 'config', 'errors', 'formatters', 'mcp-server', 'profiles', 'proxies', 'rotation', 'tool', 'token-store'].map(name => `src/${name}.ts`), ...['account', 'auth', 'node', 'pool', 'proxies', 'shop', 'tickets'].map(name => `src/tools/${name}.ts`)];
    for (const file of files) {
        const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(text, /farmer|koef|ts-api|home\/projects|mongodb|\.(?:js|ts):\d+|security@|support@/i, file);
        if (file !== 'CHANGELOG.md') assert.doesNotMatch(text, /[\u2013\u2014]/, file);
    }
});

test('server.json and package.json agree on registry name and version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    assert.equal(server.name, pkg.mcpName);
    assert.equal(server.version, pkg.version);
    assert.deepEqual(server.packages.map(entry => [entry.registryType, entry.identifier, entry.version]), [['npm', pkg.name, pkg.version]]);
    assert(server.description.length <= 100);
});

// ---- 2.2.1: server-side cap, payment IDs, require:["p0f"], clean plan names ----

const p0fTariffs = (count) => (_, res) => json(res, {data: [{_id: ids.tariff, name: '"T-Mobile" Carrier | 30-Day Plan\t\t', country_code: 'US', country_id: ids.country, carrier_id: ids.second, stock: 8, price: 129, period: 30, features: {p0f: {count, all: false}}}]});

test('2.2.1 buy sends the approved total as max_total_usd with an Idempotency-Key, and renew does too', async () => {
    const key = randomUUID();
    data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'btc', expected_total_usd: 129, confirm: true, idempotency_key: key}));
    const request = last('/payment/buy-modems-with-crypto-balance');
    assert.equal(request.body.max_total_usd, 129);
    assert.equal(request.headers['idempotency-key'], key);
    assert.equal(request.body.require, undefined);
    assert.equal(request.body.wantP0f, undefined);
    const renewKey = randomUUID();
    const renewed = data(await call('renew_modems_with_balance', {modems: [{modem_id: ids.modem, days: 30}], funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: renewKey}));
    const renew = last('/payment/renew-with-account-credit');
    assert.deepEqual(renew.body, {modems: [{modem_id: ids.modem, days: 30}], max_total_usd: 129});
    assert.equal(renew.headers['idempotency-key'], renewKey);
    assert.equal(renewed.pending, false);
});

test('2.2.1 a 200 receipt surfaces payment_id and tells the agent to poll it', async () => {
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {result: 'ok', paymentId: 'pay-200', charged_usd: 129, currency: 'USD', data: [{_id: ids.second}]}));
    const result = data(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}));
    assert.equal(result.payment_id, 'pay-200');
    assert.equal(result.pending, false);
    assert.equal(result.request.http_status, 200);
    assert.match(result.next_step, /payment_id pay-200/);
});

test('2.2.1 the server refusing above max_total_usd (409 price_changed) says nothing was charged and how to re-approve', async () => {
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {error: 'The total is $139.00, above the approved max_total_usd of $129.00. Nothing was charged.', code: 'price_changed', quote: {total_usd: 139}}, 409));
    const detail = error(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}), 'price_changed');
    assert.equal(detail.status, 409);
    assert.equal(detail.outcome, undefined);
    assert.equal(detail.details.quote.total_usd, 139);
    assert.match(detail.recovery_hint, /Nothing was charged/);
    assert.match(detail.recovery_hint, /new idempotency_key/);
});

test('2.2.1 a 503 payment_delivery_unconfirmed error carries payment_id and a poll hint, never a re-buy', async () => {
    overrides.set('POST /payment/buy-with-account-credit', (_, res) => json(res, {error: 'Payment delivery could not be confirmed. Check payment status or contact support before retrying.', code: 'PAYMENT_DELIVERY_UNCONFIRMED', paymentId: 'pay-503', charged_usd: 129}, 503));
    const detail = error(await call('buy_modems_with_balance', {tariff_id: ids.tariff, quantity: 1, funding_source: 'account_credit', expected_total_usd: 129, confirm: true, idempotency_key: randomUUID()}), 'payment_delivery_unconfirmed');
    assert.equal(detail.payment_id, 'pay-503');
    assert.equal(detail.outcome, 'unknown');
    assert.match(detail.recovery_hint, /coronium_get_payment_status with payment_id pay-503/);
    assert.match(detail.recovery_hint, /Never buy again/);
});

test('2.2.1 require:["p0f"] is checked against the plan p0f count before any charge, and want_p0f is its alias', async () => {
    const base = {tariff_id: ids.tariff, quantity: 2, funding_source: 'account_credit', expected_total_usd: 258, confirm: true};
    const refused = error(await call('buy_modems_with_balance', {...base, require: ['p0f'], idempotency_key: randomUUID()}), 'p0f_unavailable');
    assert.deepEqual(refused.details, {p0f_available: 0, requested: 2});
    error(await call('quote_purchase', {tariff_id: ids.tariff, quantity: 2, require: ['p0f']}), 'p0f_unavailable');
    assert(!requests.some(request => request.path.startsWith('/payment/')));
    overrides.set('GET /tariffs/available', p0fTariffs(3));
    const quote = data(await call('quote_purchase', {tariff_id: ids.tariff, quantity: 2, require: ['p0f']}));
    assert.deepEqual(quote.require, ['p0f']);
    assert.equal(quote.plan.p0f_available, 3);
    assert.match(quote.next_step, /require:\["p0f"\]/);
    data(await call('buy_modems_with_balance', {...base, require: ['p0f'], idempotency_key: randomUUID()}));
    assert.deepEqual(last('/payment/buy-with-account-credit').body.require, ['p0f']);
    data(await call('buy_modems_with_balance', {...base, want_p0f: true, idempotency_key: randomUUID()}));
    const alias = last('/payment/buy-with-account-credit').body;
    assert.deepEqual(alias.require, ['p0f']);
    assert.equal(alias.wantP0f, undefined);
    error(await call('buy_modems_with_balance', {...base, require: ['ipv6'], idempotency_key: randomUUID()}));
});

test('2.2.1 plan names lose trailing tabs and spaces in quote and list output', async () => {
    overrides.set('GET /tariffs/available', p0fTariffs(0));
    const quote = data(await call('quote_purchase', {tariff_id: ids.tariff, quantity: 1}));
    assert.equal(quote.plan.name, '"T-Mobile" Carrier | 30-Day Plan');
    const listed = data(await call('list_tariffs', {}));
    assert.equal(listed.tariffs[0].name, '"T-Mobile" Carrier | 30-Day Plan');
});

test('2.2.1 the agent guide no longer says receipts carry no payment ID', async () => {
    const client = await connect();
    const guide = (await client.readResource({uri: 'coronium://guide'})).contents[0].text;
    assert.doesNotMatch(guide, /carry no payment ID/);
    assert.match(guide, /Purchase receipts carry payment_id/);
    assert.match(guide, /max_total_usd/);
});

// Runs last: every request any tool made in this file maps to a fixture route.
test('every request sent during the suite matches a route in the public fixture', () => {
    const synthetic = new Set(['/payment/failure', '/payment/timeout', '/payment/html', '/modems/anything/restart']);
    const patterns = [...routeFixture.routes, ...routeFixture.non_v3_routes].map(route => ({method: route.method,
        pattern: new RegExp(`^${route.path.replace(/:[A-Za-z_]+/g, '[^/]+')}$`)}));
    const unmatched = allRequests.filter(request => !synthetic.has(request.path)
        && !patterns.some(route => route.method === request.method && route.pattern.test(request.path)));
    assert.deepEqual(unmatched.map(request => `${request.method} ${request.path}`), []);
});

