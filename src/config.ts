// Runtime configuration. All values flow through environment variables;
// defaults match production. Centralised here so every module reads from
// one place and tests can override by mutating process.env before import.

import "dotenv/config";
import crypto from "crypto";

export const SERVER_VERSION = "1.2.0";
export const SERVER_NAME = "coronium-proxy-mcp";

export const config = {
    // The public vhost api.coronium.io strips "/api" for v1 (/v1/X → backend
    // /api/v1/X) but NOT for v3 (must hit /api/v3/...). Inconsistent, but
    // documented here so the override env vars match what actually works.
    baseUrl: process.env.CORONIUM_BASE_URL || "https://api.coronium.io/v1",
    baseUrlV3: process.env.CORONIUM_BASE_URL_V3 || "https://api.coronium.io/api/v3",
    rotationServiceUrl: process.env.CORONIUM_ROTATION_URL || "https://mreset.xyz",
    pricesUrl: process.env.CORONIUM_PRICES_URL || "https://api.coingecko.com/api/v3/simple/price",
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD,
    apiToken: process.env.CORONIUM_API_TOKEN, // optional — bypasses login
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex"),
    logLevel: process.env.LOG_LEVEL || "info",
    autoLoginOn401: process.env.CORONIUM_AUTO_LOGIN !== "0", // on by default when CORONIUM_LOGIN/PASSWORD are set
};
