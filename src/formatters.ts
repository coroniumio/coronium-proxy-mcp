import {invalidResponse} from "./errors.js";
import type {ApiObject} from "./api-client.js";

export type ProxyProtocol = "http" | "socks5";

export function unwrap(value: any): any {
    return value && typeof value === "object" && "data" in value ? value.data : value;
}

export function arrayResponse(value: unknown, label: string): ApiObject[] {
    const rows = unwrap(value);
    const isObjectArray = Array.isArray(rows) && rows.every(row => row && typeof row === "object" && !Array.isArray(row));
    if (!isObjectArray) invalidResponse(`${label} did not return an array of objects.`);
    return rows;
}

function isNumericInput(value: unknown): boolean {
    if (typeof value === "number") return true;
    return typeof value === "string" && value.trim() !== "";
}

export function finiteNumber(value: unknown, label: string): number {
    if (!isNumericInput(value) || !Number.isFinite(Number(value))) invalidResponse(`${label} is unavailable; it must not be treated as zero.`);
    return Number(value);
}

export function proxyUrl(protocol: ProxyProtocol, host: string | null, port: unknown, login: unknown, password: unknown): string | null {
    if (!host || !port || login == null || password == null) return null;
    const number = Number(port);
    if (!Number.isInteger(number) || number < 1 || number > 65535 || /[\s/@?#]/.test(host)) return null;
    const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${protocol}://${encodeURIComponent(String(login))}:${encodeURIComponent(String(password))}@${address}:${number}`;
}

interface ProxyEndpoint {
    host?: string;
    port?: number | string;
    username?: string;
    password?: string;
}

function endpointUrl(protocol: ProxyProtocol, endpoint: ProxyEndpoint): string | null {
    return proxyUrl(protocol, endpoint.host ?? null, endpoint.port, endpoint.username, endpoint.password);
}

function legacyUrl(protocol: ProxyProtocol, proxy: ApiObject, host: string | null): string | null {
    const port = protocol === "http" ? proxy.http_port : proxy.socks_port;
    return proxyUrl(protocol, host, port, proxy.proxy_login, proxy.proxy_password);
}

// Deliveries with separate HTTP and SOCKS5 logins describe each protocol in
// proxyEndpoints; the legacy proxy_login/proxy_password fields are HTTP only there.
function connectionUrl(protocol: ProxyProtocol, proxy: ApiObject, host: string | null): string | null {
    const endpoint: ProxyEndpoint | undefined = proxy.proxyEndpoints?.[protocol];
    if (endpoint && typeof endpoint === "object") return endpointUrl(protocol, endpoint);
    return legacyUrl(protocol, proxy, host);
}

export function normalizeProxy(proxy: ApiObject, countries: ApiObject[] = []): ApiObject {
    const country = countries.find(item => String(item._id) === String(proxy.country_id));
    const host = proxy.connection_ip || proxy.ip_address || proxy.ipIProxyServer || proxy.host || null;
    const countryCode = proxy.country_code || proxy.country?.country_code || country?.country_code || null;
    return {...proxy, host, country_code: countryCode,
        restartToken: proxy.restartToken || null,
        http_url: connectionUrl("http", proxy, host),
        socks5_url: connectionUrl("socks5", proxy, host),
        connection_verified_by_this_tool: false};
}

export function planName(name: unknown): string | null {
    if (typeof name === "string") return name;
    if (name && typeof name === "object" && "en" in name && typeof name.en === "string") return name.en;
    return null;
}

// Support-side fields that are not meant for customers. Removed client-side
// whatever the backend returns.
const INTERNAL_TICKET_FIELDS: readonly string[] = ["internalNotes", "escalationReason", "escalated", "escalatedAt"];

export function toCustomerTicket(ticket: unknown): unknown {
    if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) return ticket;
    const view: ApiObject = {...ticket as ApiObject};
    for (const field of INTERNAL_TICKET_FIELDS) delete view[field];
    return view;
}

export function toCustomerTicketList(response: ApiObject): ApiObject {
    const tickets = response?.data?.tickets;
    if (!Array.isArray(tickets)) return response;
    return {...response, data: {...response.data, tickets: tickets.map(toCustomerTicket)}};
}

export function toCustomerTicketResponse(response: ApiObject): ApiObject {
    if (!response || typeof response !== "object" || !("data" in response)) return response;
    return {...response, data: toCustomerTicket(response.data)};
}
