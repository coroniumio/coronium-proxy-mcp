import type {ApiObject} from "./api-client.js";
import {CoroniumError} from "./errors.js";
import {endpointParts, type EndpointParts, type ProxyProtocol} from "./formatters.js";

export const SNIPPET_FORMATS = ["curl", "python_requests", "python_httpx", "node_undici", "node_axios", "playwright", "puppeteer", "selenium"] as const;
export type SnippetFormat = typeof SNIPPET_FORMATS[number];

const CHECK_URL = "https://api.ipify.org";
const BROWSER_NOTE = "Browsers (Playwright, Puppeteer, Selenium) use the HTTP endpoint: Chromium does not support SOCKS5 with a login.";
const NO_HTTP_NOTE = "This proxy has no HTTP endpoint, so there is no snippet for this client.";

// A string literal that is valid in both JavaScript and Python.
const literal = (value: string | number): string => JSON.stringify(value);
const shellQuoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const server = (endpoint: EndpointParts): string => `http://${endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host}:${endpoint.port}`;

function urlSnippets(chosen: EndpointParts): Record<string, string> {
    const extra = chosen.url.startsWith("socks5") ? "[socks]" : "";
    // socks5h sends DNS through the proxy too, so lookups leave from the mobile IP.
    const remoteDns = chosen.url.replace(/^socks5:/, "socks5h:");
    return {
        curl: `curl -x ${shellQuoted(remoteDns)} ${CHECK_URL}`,
        python_requests: `# pip install "requests${extra}"\nimport requests\nproxy = ${literal(remoteDns)}\nr = requests.get(${literal(CHECK_URL)}, proxies={"http": proxy, "https": proxy}, timeout=30)\nprint(r.text)`,
        python_httpx: `# pip install "httpx${extra}"\nimport httpx\nwith httpx.Client(proxy=${literal(chosen.url)}, timeout=30) as client:\n    print(client.get(${literal(CHECK_URL)}).text)`,
    };
}

function httpSnippets(http: EndpointParts | null): Record<string, string> {
    if (!http) return {node_undici: NO_HTTP_NOTE, node_axios: NO_HTTP_NOTE, playwright: NO_HTTP_NOTE, puppeteer: NO_HTTP_NOTE, selenium: NO_HTTP_NOTE};
    const login = `username: ${literal(http.username)}, password: ${literal(http.password)}`;
    return {
        node_undici: `import {fetch, ProxyAgent} from "undici";\nconst dispatcher = new ProxyAgent(${literal(http.url)});\nconst res = await fetch(${literal(CHECK_URL)}, {dispatcher});\nconsole.log(await res.text());`,
        node_axios: `import axios from "axios";\nconst res = await axios.get(${literal(CHECK_URL)}, {proxy: {protocol: "http", host: ${literal(http.host)}, port: ${http.port}, auth: {${login}}}});\nconsole.log(res.data);`,
        playwright: `import {chromium} from "playwright";\nconst browser = await chromium.launch({proxy: {server: ${literal(server(http))}, ${login}}});\nconst page = await browser.newPage();\nawait page.goto(${literal(CHECK_URL)});`,
        puppeteer: `import puppeteer from "puppeteer";\nconst browser = await puppeteer.launch({args: [${literal(`--proxy-server=${server(http)}`)}]});\nconst page = await browser.newPage();\nawait page.authenticate({${login}});\nawait page.goto(${literal(CHECK_URL)});`,
        selenium: `# pip install selenium-wire (plain Selenium cannot pass a proxy login to Chrome)\nfrom seleniumwire import webdriver\nproxy = ${literal(http.url)}\ndriver = webdriver.Chrome(seleniumwire_options={"proxy": {"http": proxy, "https": proxy}})\ndriver.get(${literal(CHECK_URL)})`,
    };
}

function expiry(value: unknown): string | null {
    const time = Number(value);
    return value != null && value !== "" && Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
}

function chooseProtocol(requested: ProxyProtocol | undefined, http: EndpointParts | null, socks5: EndpointParts | null): EndpointParts {
    const chosen = requested === "socks5" ? socks5 : requested === "http" ? http : http ?? socks5;
    if (chosen) return chosen;
    throw new CoroniumError({code: requested ? "protocol_unavailable" : "connection_unavailable",
        message: requested ? `This proxy has no usable ${requested} endpoint in the account data.` : "This proxy has no usable connection details in the account data.",
        suggested_action: "contact_support", details: {http_available: Boolean(http), socks5_available: Boolean(socks5)}});
}

// Ready-to-use connection settings for one normalized owned proxy. Every value comes
// from the account's proxy record; a missing part stays null and is never guessed.
export function connectionConfig(proxy: ApiObject, protocol?: ProxyProtocol, formats?: readonly SnippetFormat[]): Record<string, unknown> {
    const http = endpointParts("http", proxy, proxy.host ?? null);
    const socks5 = endpointParts("socks5", proxy, proxy.host ?? null);
    const chosen = chooseProtocol(protocol, http, socks5);
    const all = {...urlSnippets(chosen), ...httpSnippets(http)};
    const snippets = Object.fromEntries((formats?.length ? formats : SNIPPET_FORMATS).map(name => [name, all[name]]));
    const env = {HTTP_PROXY: chosen.url, HTTPS_PROXY: chosen.url, ALL_PROXY: socks5?.url ?? chosen.url};
    return {
        proxy: {modem_id: String(proxy._id), name: proxy.name ?? null, country_code: proxy.country_code ?? null,
            carrier: proxy.carrier?.name ?? null, expires_at: expiry(proxy.tariff_expired_at), is_online: proxy.isOnline ?? null,
            last_known_ip: proxy.ext_ip ?? null},
        protocol: chosen.url.startsWith("socks5") ? "socks5" : "http",
        urls: {http: http?.url ?? null, socks5: socks5?.url ?? null},
        endpoint: {host: chosen.host, port: chosen.port, username: chosen.username, password: chosen.password},
        env, env_shell: Object.entries(env).map(([name, value]) => `export ${name}=${shellQuoted(value)}`).join("\n"),
        snippets, notes: [BROWSER_NOTE, "These values are secrets: the login works for anyone who has it."],
        rotation: {tool: "coronium_rotate_modem", rotate_url: proxy.restartByToken ?? null, status_url: proxy.statusByToken ?? null,
            note: "Rotate with coronium_rotate_modem (needs the user's yes), or open rotate_url when the account supplies one. Open connections drop briefly. Keep rotate_url private."},
    };
}
