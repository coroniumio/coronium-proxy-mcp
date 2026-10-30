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
const manifest = join(pluginPath, '.claude-plugin', 'plugin.json');

test('the committed plugin passes every check', () => {
    assert.deepEqual(checkPlugins(repoDir), []);
});

test('the plugin connects only to the hosted directory server and signs in with OAuth', () => {
    const config = JSON.parse(readFileSync(join(repoDir, mcpJson), 'utf8'));
    assert.deepEqual(config.mcpServers, {coronium: {type: 'http', url: 'https://api.coronium.io/mcp'}});
    const plugin = JSON.parse(readFileSync(join(repoDir, manifest), 'utf8'));
    assert.equal('userConfig' in plugin, false);
});

test('a token setting in the manifest is refused, since it replaces the browser sign-in', () => {
    const problems = problemsAfter(dir => editJson(dir, manifest, value => {
        value.userConfig = {api_token: {type: 'string', title: 'Token', sensitive: true, required: true}};
    }));
    assertFlagged(problems, 'must not declare userConfig');
});

test('a local stdio server or a second server is refused', () => {
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => {
        value.mcpServers.coronium = {command: 'npx', args: ['-y', 'coronium-proxy-mcp@2.3.0']};
    })), 'type http');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => {
        value.mcpServers['coronium-buyer'] = {type: 'http', url: 'https://api.coronium.io/mcp/buyer'};
    })), 'expected only the hosted coronium server');
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

test('the hosted server entry is the directory URL over http, with no headers or user values', () => {
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { value.mcpServers.coronium.url = 'https://api.coronium.io/mcp/buyer'; })), 'must point at exactly');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { value.mcpServers.coronium.headers = {Authorization: 'Bearer x'}; })), 'must not set headers');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { value.mcpServers.coronium.type = 'sse'; })), 'type http');
    assertFlagged(problemsAfter(dir => editJson(dir, mcpJson, value => { value.mcpServers.coronium.env = {CORONIUM_ENABLE_SPENDING: '1'}; })), 'must not set env');
});
