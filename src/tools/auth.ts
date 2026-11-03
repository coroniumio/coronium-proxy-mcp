import {randomBytes} from "node:crypto";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {config} from "../config.js";
import {currentContext} from "../context.js";
import {CoroniumError} from "../errors.js";
import {tokenStore} from "../token-store.js";
import {registerTool} from "../tool.js";

const BUYER_MCP_URL = "https://api.coronium.io/mcp/buyer";
const SIGNUP_CODES: readonly [RegExp, string][] = [[/domain is not allowed/i, "email_domain_refused"], [/valid email/i, "invalid_email"]];

const FUNDING_STEPS: readonly string[] = [
    "coronium_get_crypto_balance: shows the USDT (TRC-20) and BTC deposit addresses.",
    "Deposit USDT or BTC to that address and wait for it to confirm.",
    "coronium_convert_crypto_to_credit with dry_run:true, then after the user's yes with confirm:true and a new idempotency_key: moves it into USD account credit.",
    "coronium_list_tariffs and coronium_quote_purchase: the exact total.",
    "After the user's yes for that total: coronium_buy_modems_with_balance with funding_source account_credit.",
];

function signupError(error: unknown): never {
    if (!(error instanceof CoroniumError) || error.details.status !== 400) throw error;
    const code = SIGNUP_CODES.find(([pattern]) => pattern.test(error.details.message))?.[1] ?? "signup_refused";
    throw new CoroniumError({...error.details, code, suggested_action: "review_request",
        recovery_hint: "No account was created. Use a different, real email address the user controls (disposable and reserved domains are refused)."});
}

// Signup answers ok for an address that already has an account (it never reveals one),
// so a refused sign-in right after it means the address was taken with another password.
function existingAccountError(error: unknown): never {
    if (!(error instanceof CoroniumError) || error.details.status !== 401) throw error;
    throw new CoroniumError({code: "account_exists", status: 401, message: "This email already has a Coronium account with a different password. Nothing was changed.",
        suggested_action: "authenticate", recovery_hint: "If it is the user's account, create an API token at https://dashboard.coronium.io (Account, API Access) and set CORONIUM_API_TOKEN. Otherwise use another email."});
}

async function createAccount(email: string, name: string, purpose: string | undefined, suppliedPassword: string | undefined): Promise<Record<string, unknown>> {
    if (tokenStore.get()) {
        throw new CoroniumError({code: "already_authenticated", message: "This MCP is already signed in to a Coronium account. Nothing was created.", suggested_action: "review_request"});
    }
    const password = suppliedPassword ?? randomBytes(18).toString("base64url");
    await api.request("/signup", {method: "POST", public: true, body: {login: email, password, name, ...(purpose ? {purpose} : {})}}).catch(signupError);
    const session = await api.request("/get-token", {method: "POST", public: true, readOnly: true, body: {login: email, password}}).catch(existingAccountError);
    if (typeof session?.token !== "string" || !session.token) throw new CoroniumError({code: "invalid_response", message: "Sign-in after signup returned no token. The account exists; sign in at https://dashboard.coronium.io.", suggested_action: "contact_support"});
    const issued = await api.request("/account/api-token", {v1: true, token: session.token});
    if (typeof issued?.token !== "string" || !issued.token) throw new CoroniumError({code: "invalid_response", message: "The account exists but no API token was returned. Create one at https://dashboard.coronium.io (Account, API Access).", suggested_action: "contact_support"});
    tokenStore.set(issued.token);
    return {
        account_email: email, created: true,
        api_token: issued.token, api_token_expires_at: issued.expiresAt ?? null,
        generated_password: suppliedPassword ? null : password,
        token_storage: config.tokenEncryptionKey ? "encrypted_file" : "memory",
        shown_once: "api_token and generated_password are shown only in this result. Store them in a secret store now; never post them in chat logs or code.",
        hosted_mcp: {url: BUYER_MCP_URL, header: "Authorization: Bearer <api_token>", note: "With this header the hosted buyer server can buy for this account. Or set CORONIUM_API_TOKEN for this npm server, or call the REST API at https://api.coronium.io/api/v3 with the same header."},
        verification: "A verification email was sent to this address. Nothing waits for it.",
        balance: "The account starts with no balance and no proxies; nothing is included until it is paid for.",
        next_steps: FUNDING_STEPS,
    };
}

// Account creation carries no existing secret, so it is on by default, but only on the
// local server, in full and buyer, and only while no token or login is configured.
function registerCreateAccount(server: McpServer): void {
    if (currentContext() || config.apiToken || config.login || tokenStore.get()) return;
    registerTool(server, "coronium_create_account", {
        description: "Create a new Coronium account for this agent, with no browser, then sign this MCP in to it. Only present while no API token or login is configured. Calls signup, signs in and issues a dashboard API token, which the rest of this session uses. Returns the API token once (for the hosted buyer server https://api.coronium.io/mcp/buyer with Authorization: Bearer, or REST) and the generated password once if none was given. The account starts empty: fund it (deposit USDT or BTC, convert to credit) and buy; nothing is included until paid. Use a real email the user controls; disposable and reserved domains are refused. Get the user's yes first.",
        input: {email: z.string().email().max(255), name: z.string().min(1).max(100),
            purpose: z.string().max(500).optional().describe("What the proxies are for, in a sentence."),
            password: z.string().min(8).max(128).optional().describe("Omit to generate a strong one, returned once.")},
        access: "write", routes: ["POST /signup", "POST /get-token", "GET /api/v1/account/api-token"],
        run: async ({email, name, purpose, password}) => createAccount(email.trim().toLowerCase(), name.trim(), purpose, password),
    });
}

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
    registerCreateAccount(server);
    registerTool(server, "coronium_logout", {
        description: "Clear the in-memory and persisted token and disable automatic login until an explicit login or process restart.",
        input: {}, access: "auth", idempotent: true, routes: [],
        run: async () => { api.logout(); return {authenticated: false, automatic_login_disabled: true}; },
    });
}
