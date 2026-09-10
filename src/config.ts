import dotenv from "dotenv";
import {readFileSync} from "node:fs";

dotenv.config({quiet: true, path: process.env.DOTENV_CONFIG_PATH});

export const SERVER_NAME = "coronium-proxy-mcp";
export const SERVER_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function flag(name: string): boolean {
    return ["1", "true"].includes((process.env[name] || "").toLowerCase());
}

function baseUrl(): string {
    const url = new URL(process.env.CORONIUM_BASE_URL || "https://api.coronium.io/api/v3");
    if (url.username || url.password || url.search || url.hash) throw new Error("CORONIUM_BASE_URL must not contain credentials, query parameters or a fragment.");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        throw new Error("CORONIUM_BASE_URL must use HTTPS (HTTP is allowed for loopback development).");
    }
    return url.href.replace(/\/$/, "");
}

const apiBase = baseUrl();
export const config = {
    baseUrl: apiBase,
    // Existing public catalog, used only to discover pool tariffs. No credentials are sent.
    catalogUrl: new URL("/api/v1/tariffs", apiBase).href,
    login: process.env.CORONIUM_LOGIN || process.env.CORONIUM_EMAIL,
    password: process.env.CORONIUM_PASSWORD,
    apiToken: process.env.CORONIUM_API_TOKEN || process.env.CORONIUM_API_KEY,
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    logLevel: process.env.LOG_LEVEL || "warn",
    autoLoginOn401: process.env.CORONIUM_AUTO_LOGIN !== "0",
    readOnly: flag("CORONIUM_READ_ONLY"),
    timeoutMs: 30_000,
    actionTimeoutMs: 180_000,
};
