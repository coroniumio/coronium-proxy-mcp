import {invalidResponse} from "./errors.js";
import type {ApiObject} from "./api-client.js";

export function unwrap(value: any): any {
    return value && typeof value === "object" && "data" in value ? value.data : value;
}

export function arrayResponse(value: unknown, label: string): ApiObject[] {
    const rows = unwrap(value);
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) invalidResponse(`${label} did not return an array of objects.`);
    return rows;
}

export function finiteNumber(value: unknown, label: string): number {
    if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) invalidResponse(`${label} is unavailable; it must not be treated as zero.`);
    return Number(value);
}

export function proxyUrl(protocol: "http" | "socks5", host: string | null, port: unknown, login: unknown, password: unknown): string | null {
    if (!host || !port || login == null || password == null) return null;
    const number = Number(port);
    if (!Number.isInteger(number) || number < 1 || number > 65535 || /[\s/@?#]/.test(host)) return null;
    const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${protocol}://${encodeURIComponent(String(login))}:${encodeURIComponent(String(password))}@${address}:${number}`;
}

export function normalizeProxy(proxy: ApiObject, countries: ApiObject[] = []): ApiObject {
    const country = countries.find(item => String(item._id) === String(proxy.country_id));
    const host = proxy.connection_ip || proxy.ip_address || proxy.ipIProxyServer || proxy.host || null;
    return {...proxy, host, country_code: proxy.country_code || proxy.country?.country_code || country?.country_code || null,
        restartToken: proxy.restartToken || null,
        http_url: proxyUrl("http", host, proxy.http_port, proxy.proxy_login, proxy.proxy_password),
        socks5_url: proxyUrl("socks5", host, proxy.socks_port, proxy.proxy_login, proxy.proxy_password),
        connection_verified_by_this_tool: false};
}

export function planName(name: unknown): string | null {
    if (typeof name === "string") return name;
    if (name && typeof name === "object" && "en" in name && typeof name.en === "string") return name.en;
    return null;
}
