// Auth tools: login, validate, logout. The other tools auto-login on 401
// so most users never call these directly — they're here for explicit
// flows (manual token refresh, switching accounts, scripted tests).

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {tokenStore} from "../token-store.js";
import {config} from "../config.js";
import {ok, err} from "../formatters.js";

export function registerAuthTools(server: McpServer) {
    server.tool(
        "coronium_login",
        "Authenticate with email + password and cache an encrypted token at ~/.coronium/token.enc. Most other tools auto-login when CORONIUM_LOGIN/CORONIUM_PASSWORD are set in the env, so calling this manually is only needed for explicit re-auth or account switching.",
        {
            login: z.string().email().optional().describe("Coronium account email. Falls back to CORONIUM_LOGIN env."),
            password: z.string().optional().describe("Coronium account password. Falls back to CORONIUM_PASSWORD env."),
        },
        async ({login, password}) => {
            const u = login || config.login;
            const p = password || config.password;
            if (!u || !p) return err("Missing credentials. Pass login+password or set CORONIUM_LOGIN/CORONIUM_PASSWORD.");
            try {
                const token = await api.login(u, p);
                return ok(`✓ Logged in as ${u}\n  token cached at ~/.coronium/token.enc (AES-256-CBC)\n  token preview: ${token.substring(0, 12)}...`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_check_token",
        "Verify the cached token is still valid. Returns true/false. Useful before a long agentic session — if invalid, call coronium_login or rely on auto-login.",
        {
            token: z.string().optional().describe("Optional explicit token to validate. Defaults to the cached one."),
        },
        async ({token}) => {
            const t = token || tokenStore.get();
            if (!t) return err("No token cached. Call coronium_login first.");
            try {
                const valid = await api.validateToken(t);
                return ok(valid ? "✓ Token is valid" : "✗ Token is invalid or expired");
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_logout",
        "Clear the cached token from ~/.coronium/token.enc. Subsequent calls will require re-authentication (manual or auto-login).",
        {},
        async () => {
            tokenStore.clear();
            return ok("✓ Token cleared. Cached file removed.");
        }
    );
}
