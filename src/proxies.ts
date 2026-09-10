import {z} from "zod";
import {api, type ApiObject} from "./api-client.js";
import {CoroniumError} from "./errors.js";
import {arrayResponse, normalizeProxy} from "./formatters.js";

export const proxyField = z.string().min(1).max(128).describe("Owned modem _id (24 hex characters), exact name or portId from get_proxies.");

export async function ownedProxies(): Promise<ApiObject[]> {
    return arrayResponse(await api.get("/account/proxies"), "Owned proxies");
}

export function findProxy(proxies: ApiObject[], identifier: string): ApiObject {
    const match = proxies.find(proxy => String(proxy._id).toLowerCase() === identifier.toLowerCase() || proxy.name === identifier || proxy.portId === identifier);
    if (!match) throw new CoroniumError({code: "proxy_not_found", message: "No matching proxy in this account.", suggested_action: "list_owned_proxies"});
    return match;
}

export async function resolveProxyId(identifier: string): Promise<string> {
    // Read through the ownership-scoped endpoint even for IDs. This also prevents
    // an accidentally supplied admin token from targeting arbitrary infrastructure.
    return String(findProxy(await ownedProxies(), identifier)._id);
}

export async function normalizedProxies(): Promise<ApiObject[]> {
    const [proxies, countries] = await Promise.all([ownedProxies(), api.publicGet("/countries").then(result => arrayResponse(result, "Countries"))]);
    return proxies.map(proxy => normalizeProxy(proxy, countries));
}
