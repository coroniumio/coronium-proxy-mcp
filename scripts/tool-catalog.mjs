import {readFileSync, writeFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
// Documentation generation has no credentials and makes no backend calls.
// It documents every tool: the full profile with spending and the opt-in login tool enabled.
for (const key of Object.keys(process.env)) if (/^CORONIUM_|^TOKEN_ENCRYPTION_KEY$/.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.CORONIUM_TOOL_PROFILE = 'full';
process.env.CORONIUM_ENABLE_SPENDING = '1';
process.env.CORONIUM_ENABLE_LOGIN_TOOL = '1';
const {createServer} = await import('../dist/mcp-server.js');
const {toolDefinitions} = await import('../dist/tool.js');
const {DIRECTORY_TOOLS, BUYER_TOOLS} = await import('../dist/profiles.js');

function accessLabel(name) {
    const definition = toolDefinitions.get(name);
    if (definition.money === 'spends') return 'spends money, needs CORONIUM_ENABLE_SPENDING=1';
    if (definition.money === 'refunds') return 'cancels with refund, needs CORONIUM_ENABLE_SPENDING=1';
    if (definition.access === 'auth') return 'opt-in, needs CORONIUM_ENABLE_LOGIN_TOOL=1';
    return definition.access;
}

function catalogLine(tool) {
    const required = (tool.inputSchema.required || []).map(name => `\`${name}\``).join(', ') || 'none';
    const profiles = [BUYER_TOOLS.has(tool.name) ? 'buyer' : '', DIRECTORY_TOOLS.has(tool.name) ? 'directory' : ''].filter(Boolean).map(name => `, ${name}`).join('');
    return `- \`${tool.name}\` (${accessLabel(tool.name)}${profiles}). Required: ${required}.`;
}

const server = createServer();
const client = new Client({name: 'catalog-generator', version: '1.0.0'});
const [a, b] = InMemoryTransport.createLinkedPair();
try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const {tools} = await client.listTools();
    const list = tools.map(catalogLine).join('\n');
    const current = readFileSync('README.md', 'utf8');
    const replacement = `<!-- TOOL_CATALOG -->\n${list}\n<!-- /TOOL_CATALOG -->`;
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
