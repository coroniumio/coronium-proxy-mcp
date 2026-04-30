// Runtime configuration. All values flow through environment variables;
// defaults match Coronium's main production API surface (v3.1.0).
//
// The OpenAPI spec lives at https://dashboard.coronium.io/api-docs/ and
// declares one production server: https://api.coronium.io/api/v3 — that
// is the route for everything (account, proxies, payments, tariffs,
// tickets, signup, get-token). New integrations should use /api/v3
// directly.

import "dotenv/config";
import crypto from "crypto";

export const SERVER_VERSION = "1.2.0";
export const SERVER_NAME = "coronium-proxy-mcp";

export const config = {
    baseUrl: process.env.CORONIUM_BASE_URL || "https://api.coronium.io/api/v3",
    rotationServiceUrl: process.env.CORONIUM_ROTATION_URL || "https://mreset.xyz",
    pricesUrl: process.env.CORONIUM_PRICES_URL || "https://api.coingecko.com/api/v3/simple/price",
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD,
    apiToken: process.env.CORONIUM_API_TOKEN, // optional — bypasses login
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex"),
    logLevel: process.env.LOG_LEVEL || "info",
    autoLoginOn401: process.env.CORONIUM_AUTO_LOGIN !== "0",
};
