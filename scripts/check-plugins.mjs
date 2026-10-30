#!/usr/bin/env node
// Static checks for the Claude plugin in plugins/coronium-mobile-proxies.
// `claude plugin validate` covers manifest syntax only. These checks cover what the
// directory scan and policy review hold or block on, plus Coronium's own rules:
// no spending tools, no credentials, no internal details, exact npx pin, copy style.
import {readdirSync, readFileSync, lstatSync, existsSync} from "node:fs";
import {join, relative, basename, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const PLUGIN_NAME = "coronium-mobile-proxies";
const API_HOST = "https://api.coronium.io/api/v3";
// The hosted server the plugin may point at. It must be the directory resource, which
// never registers money tools, and the exact URL submitted to the connector directory
// (Claude Code dedupes plugin servers and claude.ai connectors by URL).
const STDIO_SERVER_NAME = "coronium";
const REMOTE_SERVER_NAME = "coronium-remote";
const REMOTE_URL = "https://api.coronium.io/mcp";

// The directory scan blocks or holds on these files anywhere in the plugin folder.
const FORBIDDEN_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", ".npmrc", "bunfig.toml", "uv.toml", "package.json", "package-lock.json", ".env"]);
const FORBIDDEN_DIRECTORY_NAMES = new Set(["__MACOSX", "node_modules", "dist", "bin"]);
const MAX_FILE_BYTES = 256 * 1024;

// Tools that spend, refund, take credentials or change OS fingerprinting. Until Anthropic
// answers in writing, the directory plugin must not mention or rely on any of them.
const EXCLUDED_TOOL_PATTERN = /coronium_(buy_[a-z_]+|renew_[a-z_]+|topup_[a-z_]+|cancel_modem|cancel_pool_key|login|logout|set_modem_os|get_p0f_options|get_credit_cards|get_crypto_balance)\b/;

// Public-repo safety: secrets and internal operations details must never appear.
const SECRET_PATTERNS = [
    {label: "npm token", pattern: /npm_[A-Za-z0-9]{20,}/},
    {label: "JWT", pattern: /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/},
    {label: "Stripe key", pattern: /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/},
    {label: "Mongo URI", pattern: /mongodb(\+srv)?:\/\//i},
];
// Kept generic on purpose: this file is public, so it must not name internal hosts or terms.
const INTERNAL_PATTERNS = [
    {label: "internal defect wording", pattern: /\bdefects?\b/i},
    {label: "supplier split", pattern: /\bfarmers?\b|revenue split/i},
    {label: "server access detail", pattern: /\bssh\s+-|\/home\/[a-z]|\bpm2\b/i},
    {label: "source file:line", pattern: /\b[\w/-]+\.(js|ts):\d+/},
    {label: "private address", pattern: /\b(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d+\.\d+\b/},
    {label: "non-public mailbox", pattern: /\b(?!hello@)[a-z0-9._-]+@coronium\.io/i},
];

// Copy rules: a short dash only, no pipes in prose, and never call a proxy "free".
const LONG_DASH_PATTERN = /[\u2013\u2014]/;
const PIPE_PATTERN = /\|/;
const FREE_PROXY_PATTERN = /\bfree\b/i;
const LICENSE_FILE = "LICENSE";

function listFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        const stats = lstatSync(path);
        if (stats.isSymbolicLink()) {
            files.push({path, symlink: true, size: 0});
            continue;
        }
        if (stats.isDirectory()) {
            files.push({path, directory: true, size: 0});
            files.push(...listFiles(path));
            continue;
        }
        files.push({path, size: stats.size});
    }
    return files;
}

function isTextFile(path) {
    return /\.(md|json|txt)$/.test(path) || basename(path) === LICENSE_FILE;
}

function proseWithoutCode(markdown) {
    return markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

function wordCount(text) {
    return text.split(/\s+/).filter(word => /[A-Za-z]/.test(word)).length;
}

function checkFileTree(pluginDir, files) {
    const problems = [];
    for (const file of files) {
        const name = relative(pluginDir, file.path);
        if (file.symlink) problems.push(`${name}: symlinks are not allowed in the plugin`);
        if (file.directory && FORBIDDEN_DIRECTORY_NAMES.has(basename(file.path))) problems.push(`${name}: forbidden directory`);
        if (!file.directory && FORBIDDEN_FILE_NAMES.has(basename(file.path))) problems.push(`${name}: forbidden file`);
        if (file.size > MAX_FILE_BYTES) problems.push(`${name}: larger than 256 KiB`);
    }
    return problems;
}

function checkTextContent(pluginDir, files) {
    const problems = [];
    for (const file of files) {
        if (file.directory || file.symlink || !isTextFile(file.path)) continue;
        const name = relative(pluginDir, file.path);
        const text = readFileSync(file.path, "utf8");
        for (const {label, pattern} of [...SECRET_PATTERNS, ...INTERNAL_PATTERNS]) {
            if (pattern.test(text)) problems.push(`${name}: contains ${label}`);
        }
        if (EXCLUDED_TOOL_PATTERN.test(text)) problems.push(`${name}: names a tool excluded from the directory build`);
        problems.push(...checkCopyRules(name, file.path, text));
    }
    return problems;
}

function checkCopyRules(name, path, text) {
    const problems = [];
    if (LONG_DASH_PATTERN.test(text)) problems.push(`${name}: uses an em or en dash`);
    if (!path.endsWith(".md")) return problems;
    const prose = proseWithoutCode(text);
    if (PIPE_PATTERN.test(prose)) problems.push(`${name}: uses '|' in prose`);
    // The MIT licence text says "free of charge"; that is about the software, not proxies.
    if (basename(path) !== LICENSE_FILE && FREE_PROXY_PATTERN.test(prose)) problems.push(`${name}: uses the word 'free'`);
    return problems;
}

function checkManifest(pluginDir) {
    const problems = [];
    const manifest = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"));
    if (manifest.name !== PLUGIN_NAME) problems.push(`plugin.json: name must stay ${PLUGIN_NAME}`);
    const token = manifest.userConfig?.api_token;
    if (!token) return [...problems, "plugin.json: userConfig.api_token is missing"];
    if (token.sensitive !== true) problems.push("plugin.json: api_token must be sensitive");
    if (token.required !== true) problems.push("plugin.json: api_token must be required");
    if ("default" in token) problems.push("plugin.json: api_token must not have a default");
    if (manifest.icon && !existsSync(join(pluginDir, manifest.icon))) problems.push("plugin.json: icon file is missing");
    return problems;
}

function parseExactPin(arg) {
    const match = /^coronium-proxy-mcp@(\d+)\.(\d+)\.(\d+)$/.exec(arg ?? "");
    if (!match) return null;
    return match.slice(1).map(Number);
}

function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
}

function checkRemoteServer(server) {
    const problems = [];
    if (!server || typeof server !== "object") return [`.mcp.json: ${REMOTE_SERVER_NAME} must be an object`];
    if (server.type !== "http") problems.push(`.mcp.json: ${REMOTE_SERVER_NAME} must use type http`);
    if (server.url !== REMOTE_URL) problems.push(`.mcp.json: ${REMOTE_SERVER_NAME} must point at exactly ${REMOTE_URL}`);
    // A fixed Authorization header would disable the OAuth sign-in and hold a secret.
    if ("headers" in server) problems.push(`.mcp.json: ${REMOTE_SERVER_NAME} must not set headers`);
    for (const key of Object.keys(server)) {
        if (!["type", "url", "oauth"].includes(key)) problems.push(`.mcp.json: ${REMOTE_SERVER_NAME} must not set ${key}`);
    }
    if (/\$\{/.test(JSON.stringify(server))) problems.push(`.mcp.json: ${REMOTE_SERVER_NAME} must not read user or shell values`);
    return problems;
}

function checkServerConfig(pluginDir, packageVersion) {
    const problems = [];
    const servers = JSON.parse(readFileSync(join(pluginDir, ".mcp.json"), "utf8")).mcpServers ?? {};
    const names = Object.keys(servers);
    const allowed = [STDIO_SERVER_NAME, REMOTE_SERVER_NAME];
    const unexpected = names.filter(name => !allowed.includes(name));
    if (!names.includes(STDIO_SERVER_NAME) || unexpected.length) {
        return [`.mcp.json: expected the ${STDIO_SERVER_NAME} server and optionally ${REMOTE_SERVER_NAME}, found ${names.join(", ") || "none"}`];
    }
    if (names.includes(REMOTE_SERVER_NAME)) problems.push(...checkRemoteServer(servers[REMOTE_SERVER_NAME]));
    const server = servers[STDIO_SERVER_NAME];
    const environment = server.env ?? {};
    if (server.command !== "npx") problems.push(".mcp.json: the server must start with npx");
    const pinArg = (server.args ?? []).find(arg => arg.startsWith("coronium-proxy-mcp"));
    const pin = parseExactPin(pinArg);
    if (!pin) problems.push(`.mcp.json: ${pinArg ?? "the package"} must be pinned to an exact x.y.z version`);
    // The pin may lead the source version while a release is in flight, but never trail it.
    const sourceVersion = packageVersion.split(".").map(Number);
    if (pin && compareVersions(pin, sourceVersion) < 0) problems.push(`.mcp.json: pin is older than package.json ${packageVersion}`);
    if (environment.CORONIUM_API_TOKEN !== "${user_config.api_token}") problems.push(".mcp.json: the token must come only from ${user_config.api_token}");
    if (environment.CORONIUM_TOOL_PROFILE !== "directory") problems.push(".mcp.json: CORONIUM_TOOL_PROFILE must be directory");
    if (environment.CORONIUM_BASE_URL !== API_HOST) problems.push(`.mcp.json: CORONIUM_BASE_URL must be fixed to ${API_HOST}`);
    if (environment.CORONIUM_AUTO_LOGIN !== "0") problems.push(".mcp.json: CORONIUM_AUTO_LOGIN must be 0");
    for (const [key, value] of Object.entries(environment)) {
        if (/^\$\{(?!user_config\.)[^}]+\}$/.test(String(value))) problems.push(`.mcp.json: ${key} reads a value from the user's shell`);
        if (/SPEND|MONEY|PAYMENT/i.test(key) && !["0", "false", ""].includes(String(value).toLowerCase())) problems.push(`.mcp.json: ${key} would enable spending`);
        if (/PASSWORD|LOGIN$|EMAIL/i.test(key) && key !== "CORONIUM_AUTO_LOGIN") problems.push(`.mcp.json: ${key} must not be set`);
    }
    return problems;
}

function checkReadme(pluginDir) {
    const readme = readFileSync(join(pluginDir, "README.md"), "utf8");
    const words = wordCount(proseWithoutCode(readme));
    if (words <= 40) return [`README.md: needs more than 40 words outside code blocks, has ${words}`];
    return [];
}

function registeredToolNames(repoDir) {
    const names = new Set();
    const toolsDir = join(repoDir, "src", "tools");
    for (const file of readdirSync(toolsDir)) {
        const source = readFileSync(join(toolsDir, file), "utf8");
        for (const match of source.matchAll(/registerTool\(\s*server,\s*"(coronium_[a-z_]+)"/g)) names.add(match[1]);
    }
    return names;
}

function checkSkills(pluginDir, toolNames) {
    const problems = [];
    const skillsDir = join(pluginDir, "skills");
    if (!existsSync(skillsDir)) return problems;
    for (const folder of readdirSync(skillsDir)) {
        const text = readFileSync(join(skillsDir, folder, "SKILL.md"), "utf8");
        const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
        const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
        const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
        if (name !== folder) problems.push(`skills/${folder}: frontmatter name must equal the folder name`);
        if (!description) problems.push(`skills/${folder}: needs a single-line description`);
        for (const match of text.matchAll(/coronium_[a-z_]+/g)) {
            if (!toolNames.has(match[0])) problems.push(`skills/${folder}: ${match[0]} is not a tool the MCP registers`);
        }
    }
    return problems;
}

function checkMarketplace(repoDir) {
    const marketplace = JSON.parse(readFileSync(join(repoDir, ".claude-plugin", "marketplace.json"), "utf8"));
    const listed = (marketplace.plugins ?? []).map(plugin => plugin.name);
    // A buy-from-Claude plugin listed next to the directory plugin reads as sidestepping Policy 4.A.
    if (listed.length !== 1 || listed[0] !== PLUGIN_NAME) return [`marketplace.json: must list only ${PLUGIN_NAME}`];
    return [];
}

export function checkPlugins(repoDir) {
    const pluginDir = join(repoDir, "plugins", PLUGIN_NAME);
    const packageVersion = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8")).version;
    const files = listFiles(pluginDir);
    return [
        ...checkFileTree(pluginDir, files),
        ...checkTextContent(pluginDir, files),
        ...checkManifest(pluginDir),
        ...checkServerConfig(pluginDir, packageVersion),
        ...checkReadme(pluginDir),
        ...checkSkills(pluginDir, registeredToolNames(repoDir)),
        ...checkMarketplace(repoDir),
    ];
}

function main() {
    const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const problems = checkPlugins(repoDir);
    if (problems.length === 0) {
        console.log(`plugins/${PLUGIN_NAME}: all checks passed`);
        return;
    }
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
