import dotenv from "dotenv";
import {readFileSync} from "node:fs";
import {profileFromEnvironment, type ToolProfile} from "./profiles.js";

dotenv.config({quiet: true, path: process.env.DOTENV_CONFIG_PATH});

export const SERVER_NAME = "coronium-proxy-mcp";
export const SERVER_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Used whenever CORONIUM_BASE_URL is unset or empty, so a bearer token is only
// sent to the production API unless the operator deliberately overrides it.
export const DEFAULT_BASE_URL = "https://api.coronium.io/api/v3";

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

function flag(name: string): boolean {
    return ["1", "true"].includes((process.env[name] || "").toLowerCase());
}

function isAllowedProtocol(url: URL): boolean {
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

export function resolveBaseUrl(value: string | undefined): string {
    const url = new URL(value && value.trim() ? value.trim() : DEFAULT_BASE_URL);
    if (url.username || url.password || url.search || url.hash) {
        throw new Error("CORONIUM_BASE_URL must not contain credentials, query parameters or a fragment.");
    }
    if (!isAllowedProtocol(url)) {
        throw new Error("CORONIUM_BASE_URL must use HTTPS (HTTP is allowed for loopback development).");
    }
    return url.href.replace(/\/$/, "");
}

const apiBase: string = resolveBaseUrl(process.env.CORONIUM_BASE_URL);

export interface Config {
    baseUrl: string;
    catalogUrl: string;
    login: string | undefined;
    password: string | undefined;
    apiToken: string | undefined;
    tokenEncryptionKey: string | undefined;
    logLevel: string;
    autoLoginOn401: boolean;
    readOnly: boolean;
    profile: ToolProfile;
    spendingEnabled: boolean;
    timeoutMs: number;
    actionTimeoutMs: number;
}

const profile: ToolProfile = profileFromEnvironment(process.env);

export const config: Config = {
    baseUrl: apiBase,
    // Existing public catalog, used only to discover pool tariffs. No credentials are sent.
    catalogUrl: new URL("/api/v1/tariffs", apiBase).href,
    login: process.env.CORONIUM_LOGIN || process.env.CORONIUM_EMAIL,
    password: process.env.CORONIUM_PASSWORD,
    apiToken: process.env.CORONIUM_API_TOKEN || process.env.CORONIUM_API_KEY,
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    logLevel: process.env.LOG_LEVEL || "warn",
    autoLoginOn401: process.env.CORONIUM_AUTO_LOGIN !== "0",
    readOnly: profile === "read-only",
    profile,
    // Spending is opt-in and only honoured by the full profile.
    spendingEnabled: flag("CORONIUM_ENABLE_SPENDING"),
    timeoutMs: 30_000,
    actionTimeoutMs: 180_000,
};
