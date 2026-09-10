import {readFileSync, writeFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
// Documentation generation has no credentials and makes no backend calls.
for (const key of Object.keys(process.env)) if (/^CORONIUM_|^TOKEN_ENCRYPTION_KEY$/.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = '/dev/null';
const {createServer} = await import('../dist/mcp-server.js');
const server = createServer();
const client = new Client({name: 'catalog-generator', version: '1.0.0'});
const [a, b] = InMemoryTransport.createLinkedPair();
try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const {tools} = await client.listTools();
    const rows = tools.map(tool => {
        const access = ['coronium_login', 'coronium_logout'].includes(tool.name) ? 'auth' : tool.annotations.readOnlyHint ? 'read' : 'write';
        const required = (tool.inputSchema.required || []).map(name => `\`${name}\``).join(', ') || '—';
        return `| \`${tool.name}\` | ${access} | ${required} |`;
    });
    const table = ['| Tool | Access | Required arguments |', '| --- | --- | --- |', ...rows].join('\n');
    const current = readFileSync('README.md', 'utf8');
    const replacement = `<!-- TOOL_CATALOG -->\n${table}\n<!-- /TOOL_CATALOG -->`;
    const next = current.replace(/<!-- TOOL_CATALOG -->(?:[\s\S]*?<!-- \/TOOL_CATALOG -->)?/, replacement);
    const manifest = JSON.stringify({version: client.getServerVersion().version, tools}, null, 2) + '\n';
    if (process.argv.includes('--check')) {
        if (next !== current || manifest !== readFileSync('docs/tool-catalog.json', 'utf8')) throw new Error('Tool catalog is stale; run npm run docs:generate.');
    } else {
        writeFileSync('README.md', next);
        writeFileSync('docs/tool-catalog.json', manifest);
    }
    process.stdout.write(`${tools.length} documented tool schemas verified.\n`);
} finally {await client.close(); await server.close();}
