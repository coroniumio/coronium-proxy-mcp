import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
// Opt-in production smoke: exactly four unauthenticated catalog GET tools.
// No customer credentials, pool usage refresh, modem action or money route.
for (const key of Object.keys(process.env)) if (/^CORONIUM_|^TOKEN_ENCRYPTION_KEY$/.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.CORONIUM_READ_ONLY = 'true';
process.env.CORONIUM_BASE_URL = 'https://api.coronium.io/api/v3';
const {createServer} = await import('../dist/mcp-server.js');
const server = createServer();
const client = new Client({name: 'public-catalog-smoke', version: '1.0.0'});
const [a, b] = InMemoryTransport.createLinkedPair();
try {
    await Promise.all([server.connect(a), client.connect(b)]);
    for (const [name, field] of [['list_countries', 'countries'], ['list_tariffs', 'tariffs'], ['list_free_modems', 'stock'], ['list_pool_tariffs', 'tariffs']]) {
        const result = await client.callTool({name: `coronium_${name}`, arguments: {}});
        assert.notEqual(result.isError, true, JSON.stringify(result));
        const data = result.structuredContent.data;
        assert(Array.isArray(data[field]));
        process.stdout.write(`${name}: valid contract, ${data[field].length} rows\n`);
    }
} finally {await client.close(); await server.close();}
