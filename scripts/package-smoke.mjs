import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const temporary = mkdtempSync(join(tmpdir(), 'coronium-mcp-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let client;
const backend = createServer((req, res) => {
    assert.equal(req.url, '/api/v3/account');
    assert.equal(req.headers.authorization, 'Bearer package-fixture-token');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({accountCredit: 99, btc: {balance: 0}, usdt: {balance: 12}}));
});
try {
    // Pack without lifecycle stdout so JSON parsing is deterministic; npm check
    // has already produced a clean build before this command runs in CI.
    const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {encoding: 'utf8'}))[0];
    const paths = packed.files.map(file => file.path);
    for (const required of ['dist/server.js', 'dist/mcp-server.js', 'package.json', 'README.md', 'llms.txt']) assert(paths.includes(required), required);
    assert(!paths.some(path => /(^|\/)(?:\.env|token\.enc|\.npmrc)$/.test(path)));
    assert(!paths.includes('dist/prices.js'));
    const install = join(temporary, 'install');
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), '{"name":"package-smoke","private":true}');
    execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], {cwd: install, stdio: 'pipe'});
    const entry = join(install, 'node_modules/coronium-proxy-mcp/dist/server.js');
    const metadata = JSON.parse(readFileSync(join(install, 'node_modules/coronium-proxy-mcp/package.json'), 'utf8'));
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    client = new Client({name: 'package-smoke', version: '1.0.0'});
    const transport = new StdioClientTransport({command: process.execPath, args: [entry], cwd: install, stderr: 'pipe', env: {
        PATH: process.env.PATH, HOME: temporary, DOTENV_CONFIG_PATH: join(temporary, 'absent.env'), CORONIUM_API_TOKEN: 'package-fixture-token',
        CORONIUM_BASE_URL: `http://127.0.0.1:${backend.address().port}/api/v3`, CORONIUM_READ_ONLY: 'true',
    }});
    let stderr = ''; transport.stderr?.on('data', chunk => {stderr += chunk;});
    await client.connect(transport);
    assert.equal(client.getServerVersion().version, metadata.version);
    const {tools} = await client.listTools();
    assert(tools.some(tool => tool.name === 'coronium_get_balance'));
    assert(!tools.some(tool => tool.name === 'coronium_buy_modems_with_balance'));
    const result = await client.callTool({name: 'coronium_get_balance', arguments: {}});
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.data.account_credit.amount, 99);
    assert.equal(stderr, '');
    process.stdout.write(`Package ${metadata.version}: ${paths.length} files; clean install and stdio balance contract passed.\n`);
} finally {
    await client?.close();
    await new Promise(resolve => backend.close(resolve));
    rmSync(temporary, {recursive: true, force: true});
}
