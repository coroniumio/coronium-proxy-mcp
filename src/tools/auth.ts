import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {CoroniumError} from "../errors.js";
import {registerTool} from "../tool.js";

function registerCheckToken(server: McpServer): void {
    const description = "Check that the configured API token is accepted by the account API. Returns valid:false for rejected credentials; network failures remain errors.";
    // The directory and buyer builds never accept a token typed into the conversation.
    if (config.profile === "directory" || config.profile === "buyer") {
        registerTool(server, "coronium_check_token", {
            description, input: {}, routes: ["GET /account"],
            run: async () => ({valid: await api.validateToken()}),
        });
        return;
    }
    registerTool(server, "coronium_check_token", {
        description: `${description} An optional token argument checks a different token; prefer environment configuration over pasting secrets.`,
        input: {token: z.string().min(1).optional()}, routes: ["GET /account"],
        run: async ({token}) => ({valid: await api.validateToken(token)}),
    });
}

// coronium_login and coronium_logout are access "auth": they are registered only
// when the host sets CORONIUM_ENABLE_LOGIN_TOOL=1, because a password passed as a
// tool argument ends up in the conversation. CORONIUM_API_TOKEN is the normal path.
export function registerAuthTools(server: McpServer): void {
    registerTool(server, "coronium_login", {
        description: "Log in with account credentials. Only present when the host set CORONIUM_ENABLE_LOGIN_TOOL=1. Prefer CORONIUM_API_TOKEN in the host configuration; a password passed here is visible in the conversation. Tokens remain in memory unless TOKEN_ENCRYPTION_KEY is configured; no token is returned.",
        input: {login: z.string().min(1).max(255).optional(), password: z.string().min(1).optional()}, access: "auth",
        routes: ["POST /get-token"],
        run: async ({login, password}) => {
            const account = login || config.login;
            const secret = password || config.password;
            if (!account || !secret) throw new CoroniumError({code: "missing_credentials", message: "Set CORONIUM_LOGIN and CORONIUM_PASSWORD, or supply both credentials."});
            await api.login(account, secret);
            return {authenticated: true, token_storage: config.tokenEncryptionKey ? "encrypted_file" : "memory"};
        },
    });
    registerCheckToken(server);
    registerTool(server, "coronium_logout", {
        description: "Clear the in-memory and persisted token and disable automatic login until an explicit login or process restart.",
        input: {}, access: "auth", idempotent: true, routes: [],
        run: async () => { api.logout(); return {authenticated: false, automatic_login_disabled: true}; },
    });
}
