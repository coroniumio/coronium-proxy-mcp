import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkPlugins} from '../scripts/check-plugins.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = join('plugins', 'coronium-mobile-proxies');

// Copies only what the checker reads, so each test can break one thing in isolation.
function copyRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'coronium-plugin-check-'));
    for (const path of ['package.json', 'src/tools', '.claude-plugin', pluginPath]) {
        cpSync(join(repoDir, path), join(dir, path), {recursive: true});
    }
    return dir;
}

function editJson(dir, path, change) {
    const file = join(dir, path);
    const value = JSON.parse(readFileSync(file, 'utf8'));
    change(value);
    writeFileSync(file, JSON.stringify(value, null, 2));
}

function appendText(dir, path, text) {
    const file = join(dir, path);
    writeFileSync(file, readFileSync(file, 'utf8') + text);
}

function problemsAfter(change) {
    const dir = copyRepo();
    try {
        change(dir);
        return checkPlugins(dir);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
}

function assertFlagged(problems, fragment) {
    assert.ok(problems.some(problem => problem.includes(fragment)), `expected a problem containing "${fragment}", got ${JSON.stringify(problems)}`);
}

const mcpJson = join(pluginPath, '.mcp.json');
const readme = join(pluginPath, 'README.md');
const serverEnv = value => value.mcpServers.coronium.env;

test('the committed plugin passes every check', () => {
    assert.deepEqual(checkPlugins(repoDir), []);
});

test('the plugin runs the directory profile against the fixed production host with the token from userConfig', () => {
    const config = JSON.parse(readFileSync(join(repoDir, mcpJson), 'utf8'));
    const server = config.mcpServers.coronium;
    assert.equal(server.command, 'npx');
    assert.match(server.args.find(arg => arg.startsWith('coronium-proxy-mcp')), /^coronium-proxy-mcp@\d+\.\d+\.\d+$/);
    assert.deepEqual(server.env, {
        CORONIUM_API_TOKEN: '${user_config.api_token}',
        CORONIUM_TOOL_PROFILE: 'directory',
        CORONIUM_BASE_URL: 'https://api.coronium.io/api/v3',
        CORONIUM_AUTO_LOGIN: '0',
    });
});

test('an unpinned or ranged npx launcher is refused', () => {
    for (const arg of ['coronium-proxy-mcp', 'coronium-proxy-mcp@latest', 'coronium-proxy-mcp@^2.1.0']) {
        const problems = problemsAfter(dir => editJson(dir, mcpJson, value => { value.mcpServers.coronium.args = ['-y', arg]; }));
        assertFlagged(problems, 'exact x.y.z');
    }
});

test('a pin older than the source version is refused', () => {
    const problems = problemsAfter(dir => editJson(dir, mcpJson, value => { value.mcpServers.coronium.args = ['-y', 'coronium-proxy-mcp@1.3.0']; }));
    assertFlagged(problems, 'older than package.json');
});

test('switching to the full profile or opting into spending is refused', () => {
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { serverEnv(value).CORONIUM_TOOL_PROFILE = 'full'; })), 'must be directory');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { serverEnv(value).CORONIUM_ENABLE_SPENDING = '1'; })), 'would enable spending');
});

test('a shell credential passthrough or unfixed base URL is refused', () => {
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { serverEnv(value).CORONIUM_API_TOKEN = '${CORONIUM_API_TOKEN}'; })), 'reads a value from the user');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { delete serverEnv(value).CORONIUM_BASE_URL; })), 'CORONIUM_BASE_URL');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { serverEnv(value).CORONIUM_PASSWORD = 'x'; })), 'must not be set');
});

test('the token setting must stay sensitive and required', () => {
    const manifest = join(pluginPath, '.claude-plugin', 'plugin.json');
    assertFlagged(problemsAfter(dir => editJson(dir, manifest, value => { value.userConfig.api_token.sensitive = false; })), 'sensitive');
});

test('spending and credential tools may not appear in plugin text', () => {
    for (const tool of ['coronium_buy_modems_with_balance', 'coronium_renew_modems_with_balance', 'coronium_cancel_modem', 'coronium_login']) {
        assertFlagged(problemsAfter(dir => appendText(dir, readme, `\nCall ${tool} when asked.\n`)), 'excluded from the directory build');
    }
});

test('a skill that names a tool the MCP does not register is refused', () => {
    const skill = join(pluginPath, 'skills', 'check-my-proxies', 'SKILL.md');
    assertFlagged(problemsAfter(dir => appendText(dir, skill, '\nCall `coronium_rotate_everything`.\n')), 'is not a tool the MCP registers');
});

test('secrets and internal details are refused in public plugin files', () => {
    const cases = [
        ['npm_' + 'a'.repeat(36), 'npm token'],
        ['mongodb://user:pass@host/db', 'Mongo URI'],
        ['see the internal defect list', 'internal defect wording'],
        ['the farmer share', 'supplier split'],
        ['ssh -p 22 example-host', 'server access detail'],
        ['see handler.js:120', 'source file:line'],
        ['reach it at 10.0.0.5', 'private address'],
        ['write to security@coronium.io', 'non-public mailbox'],
    ];
    for (const [text, label] of cases) assertFlagged(problemsAfter(dir => appendText(dir, readme, `\n${text}\n`)), label);
});

test('copy rules: no long dashes, no pipes in prose, never "free"', () => {
    assertFlagged(problemsAfter(dir => appendText(dir, readme, '\nFast \u2014 and reliable.\n')), 'em or en dash');
    assertFlagged(problemsAfter(dir => appendText(dir, readme, '\nHTTP | SOCKS5\n')), "'|'");
    assertFlagged(problemsAfter(dir => appendText(dir, readme, '\nTry a free proxy.\n')), "'free'");
});

test('forbidden files and a second marketplace plugin are refused', () => {
    assertFlagged(problemsAfter(dir => writeFileSync(join(dir, pluginPath, '.DS_Store'), '')), 'forbidden file');
    assertFlagged(problemsAfter(dir => writeFileSync(join(dir, pluginPath, '.npmrc'), '')), 'forbidden file');
    assertFlagged(problemsAfter(dir => mkdirSync(join(dir, pluginPath, 'bin'))), 'forbidden directory');
    const marketplace = join('.claude-plugin', 'marketplace.json');
    assertFlagged(problemsAfter(dir => editJson(dir, marketplace, value => { value.plugins.push({name: 'coronium-proxy-buyer', source: './plugins/coronium-proxy-buyer'}); })), 'must list only');
});
