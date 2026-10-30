import {createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {randomUUID} from "node:crypto";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {config, resolveBaseUrl, SERVER_VERSION} from "./config.js";
import {type RemoteScope, runWithContext} from "./context.js";
import {createServer} from "./mcp-server.js";
import type {ToolProfile} from "./profiles.js";
import {BearerVerifier, sha256} from "./remote-auth.js";
import {toolDefinitions} from "./tool.js";

// Hosted Coronium MCP over Streamable HTTP, stateless: every POST builds a fresh
// McpServer inside the caller's request context, so tools/list always reflects the
// connection's current scopes and spending switch, and no state crosses users.
//
//   /mcp        directory profile. Never registers money tools, whatever the token says.
//   /mcp/buyer  buyer profile. Money tools only with scope `spend` AND the connection's
//               spending switch on (set by the user in the dashboard, off by default).

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_ORIGINS: readonly string[] = ["https://claude.ai", "https://claude.com"];

interface ResourceDefinition {
    path: string;
    profile: ToolProfile;
    scopes: readonly RemoteScope[];
    // Scopes asked for in the 401 challenge. `spend` is only ever asked for in a step-up.
    challengeScopes: readonly RemoteScope[];
}

const RESOURCES: readonly ResourceDefinition[] = [
    {path: "/mcp", profile: "directory", scopes: ["read", "manage"], challengeScopes: ["read", "manage"]},
    {path: "/mcp/buyer", profile: "buyer", scopes: ["read", "manage", "spend"], challengeScopes: ["read", "manage"]},
];

export interface HostedOptions {
    publicUrl: string;
    apiBaseUrl: string;
    allowedHosts: readonly string[];
    allowedOrigins: readonly string[];
    log?: (line: Record<string, unknown>) => void;
    verifier?: BearerVerifier;
}

export function resourceUrl(publicUrl: string, path: string): string {
    return publicUrl.replace(/\/$/, "") + path;
}

export function metadataUrl(publicUrl: string, path: string): string {
    return resourceUrl(publicUrl, `/.well-known/oauth-protected-resource${path}`);
}

export function protectedResourceMetadata(publicUrl: string, resource: ResourceDefinition): Record<string, unknown> {
    return {
        resource: resourceUrl(publicUrl, resource.path),
        // Only the first entry is used by Claude. The authorization server shares the host.
        authorization_servers: [publicUrl.replace(/\/$/, "")],
        scopes_supported: [...resource.scopes],
        bearer_methods_supported: ["header"],
        resource_name: resource.profile === "buyer" ? "Coronium Mobile Proxies (buyer)" : "Coronium Mobile Proxies",
        resource_documentation: "https://github.com/coroniumio/coronium-proxy-mcp#hosted-server",
        resource_policy_uri: "https://www.coronium.io/privacy-policy",
    };
}

function moneyToolNames(): Set<string> {
    // Building one server outside any request context fills the tool definition table.
    createServer();
    return new Set([...toolDefinitions.values()].filter(tool => tool.money !== "none").map(tool => tool.name));
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store", ...headers});
    res.end(JSON.stringify(body));
}

function quote(value: string): string {
    return `"${value.replace(/["\\]/g, "")}"`;
}

function challenge(publicUrl: string, resource: ResourceDefinition, error?: {code: string; description: string; scopes?: readonly string[]}): string {
    const parts: string[] = [];
    if (error) parts.push(`error=${quote(error.code)}`, `error_description=${quote(error.description)}`);
    parts.push(`resource_metadata=${quote(metadataUrl(publicUrl, resource.path))}`);
    parts.push(`scope=${quote((error?.scopes ?? resource.challengeScopes).join(" "))}`);
    return `Bearer ${parts.join(", ")}`;
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) return null;
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

function bearerOf(req: IncomingMessage): string | null {
    const header = req.headers.authorization;
    if (typeof header !== "string") return null;
    const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
    return match ? match[1] : null;
}

interface RpcSummary {
    method: string | null;
    tool: string | null;
    argKeys: string[];
}

function summarize(message: unknown): RpcSummary[] {
    const list = Array.isArray(message) ? message : [message];
    return list.map(item => {
        const value = (item && typeof item === "object" ? item : {}) as Record<string, any>;
        const params = value.params && typeof value.params === "object" ? value.params : {};
        const args = params.arguments && typeof params.arguments === "object" ? Object.keys(params.arguments).slice(0, 30) : [];
        return {
            method: typeof value.method === "string" ? value.method.slice(0, 64) : null,
            tool: value.method === "tools/call" && typeof params.name === "string" ? params.name.slice(0, 64) : null,
            argKeys: args,
        };
    });
}

export function createHostedServer(options: HostedOptions): Server {
    const publicUrl = options.publicUrl.replace(/\/$/, "");
    const verifier = options.verifier ?? new BearerVerifier(options.apiBaseUrl);
    const money = moneyToolNames();
    const log = options.log ?? (line => process.stdout.write(JSON.stringify(line) + "\n"));
    const allowedHosts = new Set(options.allowedHosts.map(host => host.toLowerCase()));
    const allowedOrigins = new Set(options.allowedOrigins);

    async function handleMcp(req: IncomingMessage, res: ServerResponse, resource: ResourceDefinition, entry: Record<string, unknown>): Promise<void> {
        if (req.method !== "POST") {
            entry.outcome = "method_not_allowed";
            sendJson(res, 405, {jsonrpc: "2.0", error: {code: -32000, message: "Method not allowed. This server is stateless: use POST."}, id: null}, {Allow: "POST"});
            return;
        }
        const origin = req.headers.origin;
        if (typeof origin === "string" && !allowedOrigins.has(origin)) {
            entry.outcome = "origin_rejected";
            sendJson(res, 403, {error: "origin_not_allowed"});
            return;
        }
        if (new URL(req.url ?? "/", "http://localhost").search.match(/(?:^|[?&])(access_token|auth_token)=/)) {
            entry.outcome = "token_in_query";
            sendJson(res, 400, {error: "invalid_request", error_description: "Send the token in the Authorization header, never in the URL."});
            return;
        }
        const token = bearerOf(req);
        if (!token) {
            entry.outcome = 401;
            sendJson(res, 401, {error: "invalid_token", error_description: "Sign in with your Coronium account."}, {"WWW-Authenticate": challenge(publicUrl, resource)});
            return;
        }
        const verified = await verifier.verify(token);
        if (!verified.ok) {
            if (verified.reason === "upstream_unavailable") {
                entry.outcome = "upstream_unavailable";
                sendJson(res, 503, {error: "temporarily_unavailable", error_description: "Coronium could not check this sign-in right now. Try again shortly."}, {"Retry-After": "10"});
                return;
            }
            entry.outcome = 401;
            sendJson(res, 401, {error: "invalid_token", error_description: "The sign-in expired or was revoked."},
                {"WWW-Authenticate": challenge(publicUrl, resource, {code: "invalid_token", description: "The access token is invalid, expired or revoked."})});
            return;
        }
        const bearer = verified.bearer;
        const expectedResource = resourceUrl(publicUrl, resource.path);
        // Audience: an OAuth token is bound to exactly one resource URL.
        if (bearer.auth === "oauth" && bearer.resource !== expectedResource) {
            entry.outcome = 401;
            sendJson(res, 401, {error: "invalid_token", error_description: "This sign-in was made for a different Coronium address."},
                {"WWW-Authenticate": challenge(publicUrl, resource, {code: "invalid_token", description: "The token audience does not match this resource."})});
            return;
        }
        entry.conn = sha256(bearer.connectionId).slice(0, 8);
        const raw = await readBody(req);
        if (raw === null) {
            entry.outcome = "body_too_large";
            sendJson(res, 413, {jsonrpc: "2.0", error: {code: -32600, message: "Request body too large."}, id: null});
            return;
        }
        let body: unknown;
        try {
            body = JSON.parse(raw.toString("utf8"));
        } catch {
            entry.outcome = "parse_error";
            sendJson(res, 400, {jsonrpc: "2.0", error: {code: -32700, message: "Parse error"}, id: null});
            return;
        }
        const calls = summarize(body);
        entry.rpc = calls.map(call => ({method: call.method, tool: call.tool, arg_keys: call.argKeys}));
        const scopes = bearer.scopes.filter(scope => resource.scopes.includes(scope));
        // The directory resource never spends, whatever the token holds.
        const spendingEnabled = resource.profile === "buyer" && bearer.spendingEnabled && scopes.includes("spend");
        const wantsMoney = calls.some(call => call.tool !== null && money.has(call.tool));
        if (resource.profile === "buyer" && wantsMoney && !scopes.includes("spend")) {
            entry.outcome = 403;
            sendJson(res, 403, {error: "insufficient_scope", error_description: "Purchases need the spend permission for this connection."},
                {"WWW-Authenticate": challenge(publicUrl, resource, {code: "insufficient_scope", description: "Purchases need the spend scope.", scopes: ["read", "manage", "spend"]})});
            return;
        }
        await runWithContext({
            transport: "streamable-http", profile: resource.profile, scopes, spendingEnabled, token,
            connectionId: bearer.connectionId, auth: bearer.auth, resource: expectedResource, apiBaseUrl: options.apiBaseUrl,
        }, async () => {
            const server = createServer();
            const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
            res.on("close", () => {
                transport.close().catch(() => undefined);
                server.close().catch(() => undefined);
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        });
        entry.outcome = res.statusCode < 400 ? "ok" : res.statusCode;
    }

    async function route(req: IncomingMessage, res: ServerResponse, entry: Record<string, unknown>): Promise<void> {
        const host = String(req.headers.host ?? "").toLowerCase();
        if (allowedHosts.size && !allowedHosts.has(host)) {
            entry.outcome = "host_rejected";
            sendJson(res, 403, {error: "host_not_allowed"});
            return;
        }
        const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/$/, "") || "/";
        entry.path = path;
        const resource = RESOURCES.find(item => item.path === path);
        if (resource) {
            entry.resource = resource.path;
            await handleMcp(req, res, resource, entry);
            return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            sendJson(res, 404, {error: "not_found"});
            return;
        }
        if (path === "/healthz") {
            sendJson(res, 200, {ok: true, version: SERVER_VERSION});
            return;
        }
        const wellKnown = "/.well-known/oauth-protected-resource";
        if (path === wellKnown || path.startsWith(wellKnown + "/")) {
            // The bare path is an alias of the /mcp resource.
            const suffix = path === wellKnown ? "/mcp" : path.slice(wellKnown.length);
            const match = RESOURCES.find(item => item.path === suffix);
            if (match) {
                sendJson(res, 200, protectedResourceMetadata(publicUrl, match), {"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"});
                return;
            }
        }
        sendJson(res, 404, {error: "not_found"});
    }

    return createHttpServer((req, res) => {
        const started = Date.now();
        const entry: Record<string, unknown> = {ts: new Date(started).toISOString(), request_id: randomUUID(), method: req.method};
        res.on("finish", () => {
            if (entry.path === "/healthz") return;
            log({...entry, status: res.statusCode, latency_ms: Date.now() - started});
        });
        route(req, res, entry).catch(() => {
            entry.outcome = "internal_error";
            if (!res.headersSent) sendJson(res, 500, {jsonrpc: "2.0", error: {code: -32603, message: "Internal error"}, id: null});
            else res.end();
        });
    });
}

// Host credentials would let one process act for one account on behalf of everyone.
const FORBIDDEN_HOSTED_SETTINGS: readonly string[] = [
    "CORONIUM_API_TOKEN", "CORONIUM_API_KEY", "CORONIUM_LOGIN", "CORONIUM_EMAIL", "CORONIUM_PASSWORD",
    "CORONIUM_ENABLE_SPENDING", "CORONIUM_ENABLE_LOGIN_TOOL", "TOKEN_ENCRYPTION_KEY",
];

export function hostedOptionsFromEnvironment(environment: NodeJS.ProcessEnv): HostedOptions {
    const present = FORBIDDEN_HOSTED_SETTINGS.filter(name => (environment[name] ?? "") !== "");
    if (present.length) throw new Error(`The hosted server refuses to start with ${present.join(", ")} set. It only uses each caller's own sign-in.`);
    const publicUrl = new URL(environment.MCP_PUBLIC_URL || "https://api.coronium.io");
    if (publicUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(publicUrl.hostname)) throw new Error("MCP_PUBLIC_URL must use HTTPS.");
    if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) throw new Error("MCP_PUBLIC_URL must be an origin, for example https://api.coronium.io.");
    const hosts = (environment.MCP_ALLOWED_HOSTS || publicUrl.host).split(",").map(value => value.trim()).filter(Boolean);
    const origins = environment.MCP_ALLOWED_ORIGINS ? environment.MCP_ALLOWED_ORIGINS.split(",").map(value => value.trim()).filter(Boolean) : [...DEFAULT_ORIGINS];
    return {publicUrl: publicUrl.origin, apiBaseUrl: resolveBaseUrl(environment.CORONIUM_BASE_URL), allowedHosts: hosts, allowedOrigins: origins};
}

export function hostedPort(environment: NodeJS.ProcessEnv): {port: number; host: string} {
    const port = Number(environment.PORT || 5031);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT must be a TCP port.");
    return {port, host: environment.HOST || "127.0.0.1"};
}

// Keeps config imported so its dotenv guard runs before anything reads the environment.
void config;
