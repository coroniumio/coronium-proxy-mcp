// Shared output formatters for tool results. Keeping these in one place
// keeps the wire format consistent across tools — agents and humans both
// see the same headings, the same field ordering, the same error markers.

// Public v3 endpoints (countries, tariffs, free-modems) wrap arrays as
// {data: [...]}; v1 endpoints return raw arrays/objects. This unwraps
// either shape so tools can iterate uniformly.
export function unwrap<T = any>(r: any): T {
    if (r && typeof r === "object" && Array.isArray(r.data)) return r.data as T;
    if (r && typeof r === "object" && r.data && !Array.isArray(r) && typeof r.data === "object") return r.data as T;
    return r as T;
}

export function ok(text: string) {
    return {content: [{type: "text" as const, text}]};
}

export function err(text: string) {
    return {content: [{type: "text" as const, text: `❌ ${text}`}], isError: true};
}

export function maskUrl(url: string | undefined): string {
    if (!url) return "";
    return url.replace(/https?:\/\/[^\/]+/g, "https://***");
}

export function formatProxyLine(p: any): string {
    const exp = p.tariff_expired_at || p.expires_at;
    const expIso = exp ? new Date(exp).toISOString() : "n/a";
    const ip = p.ipIProxyServer || p.host || "?";
    const httpPort = p.http_port || "?";
    const socksPort = p.socks_port || "?";
    const country = p.country?.country_code || p.country?.code || p.country_code || "?";
    return `  ${p.name || p.portId || "?"} (${p._id || "?"})\n` +
        `    country=${country} | http=${ip}:${httpPort} | socks=${ip}:${socksPort}\n` +
        `    login=${p.proxy_login || "?"} | expires=${expIso}`;
}

export function formatProxyDetail(p: any): string {
    const ip = p.ipIProxyServer || p.host || "?";
    const expIso = p.tariff_expired_at ? new Date(p.tariff_expired_at).toISOString() : (p.expires_at || "n/a");
    return [
        `proxy_id:        ${p._id}`,
        `name:            ${p.name || p.portId}`,
        `port_id:         ${p.portId || "—"}`,
        `host:            ${ip}`,
        `http_port:       ${p.http_port}`,
        `socks_port:      ${p.socks_port}`,
        `proxy_login:     ${p.proxy_login}`,
        `proxy_password:  ${p.proxy_password}`,
        `country:         ${p.country?.country_code || p.country_code || "?"}`,
        `external_ip:     ${p.ext_ip || "?"}`,
        `expires_at:      ${expIso}`,
        `auto_rotate_s:   ${p.rotation_interval ?? 0}`,
        `status:          ${p.status || "?"}`,
        `is_online:       ${p.isOnline}`,
    ].join("\n");
}

export function formatTimestamp(ms: number | string | undefined): string {
    if (!ms) return "n/a";
    const n = typeof ms === "string" ? Date.parse(ms) : ms;
    if (!Number.isFinite(n)) return "n/a";
    return new Date(n).toISOString();
}
