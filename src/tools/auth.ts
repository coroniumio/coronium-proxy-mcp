import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {CoroniumError} from "../errors.js";
import {registerTool} from "../tool.js";

export function registerAuthTools(server: McpServer): void {
    registerTool(server, "coronium_login", {
        description: "Log in using account credentials. Prefer environment credentials over passing secrets through a conversation. Tokens remain in memory unless TOKEN_ENCRYPTION_KEY is configured; no token is returned.",
        input: {login: z.string().email().optional(), password: z.string().min(1).optional()}, access: "auth",
        run: async ({login, password}) => {
            const email = login || config.login;
            const secret = password || config.password;
            if (!email || !secret) throw new CoroniumError({code: "missing_credentials", message: "Set CORONIUM_LOGIN and CORONIUM_PASSWORD, or supply both credentials."});
            await api.login(email, secret);
            return {authenticated: true, token_storage: config.tokenEncryptionKey ? "encrypted_file" : "memory"};
        },
    });
    registerTool(server, "coronium_check_token", {
        description: "Validate the current or supplied token against the account API. Returns valid:false for rejected credentials; network failures remain errors.",
        input: {token: z.string().min(1).optional()},
        run: async ({token}) => ({valid: await api.validateToken(token)}),
    });
    registerTool(server, "coronium_logout", {
        description: "Clear the in-memory and persisted token and disable automatic login until an explicit login or process restart.",
        input: {}, access: "auth", idempotent: true,
        run: async () => { api.logout(); return {authenticated: false, automatic_login_disabled: true}; },
    });
}
