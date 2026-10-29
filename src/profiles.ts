export type Access = "read" | "write" | "auth";
export type MoneyEffect = "none" | "spends" | "refunds";
export type ToolProfile = "full" | "buyer" | "directory" | "read-only";

export interface ToolTraits {
    access: Access;
    money: MoneyEffect;
}

export const TOOL_PROFILES: readonly ToolProfile[] = ["full", "buyer", "directory", "read-only"];

// The directory profile is an explicit allowlist, not a predicate over traits:
// a new tool stays out of the directory build until someone adds it here and
// to test/profiles/directory.json on purpose.
export const DIRECTORY_TOOLS: ReadonlySet<string> = new Set([
    "coronium_check_token",
    "coronium_get_account",
    "coronium_get_balance",
    "coronium_get_proxies",
    "coronium_get_proxy",
    "coronium_get_proxy_health",
    "coronium_test_modem",
    "coronium_rotate_modem",
    "coronium_get_rotation_status",
    "coronium_replace_modem",
    "coronium_get_openvpn_config",
    "coronium_list_countries",
    "coronium_list_tariffs",
    "coronium_list_free_modems",
    "coronium_get_renewal_quote",
    "coronium_list_tickets",
    "coronium_get_ticket",
    "coronium_create_ticket",
    "coronium_reply_to_ticket",
    "coronium_get_webhook",
    "coronium_get_capabilities",
]);

// The buyer profile is the short path for an agent that buys and runs a few
// dedicated proxies: catalog, quote, buy, payment status, the proxies it owns
// and the everyday fixes. Same rule as the directory list: explicit names only.
// The buy tool is listed here but still needs CORONIUM_ENABLE_SPENDING.
export const BUYER_TOOLS: ReadonlySet<string> = new Set([
    "coronium_get_capabilities",
    "coronium_list_tariffs",
    "coronium_list_free_modems",
    "coronium_quote_purchase",
    "coronium_buy_modems_with_balance",
    "coronium_get_payment_status",
    "coronium_get_proxies",
    "coronium_test_modem",
    "coronium_rotate_modem",
    "coronium_get_rotation_status",
    "coronium_replace_modem",
    "coronium_get_balance",
    "coronium_get_crypto_balance",
]);

function isProfileName(value: string): value is ToolProfile {
    return (TOOL_PROFILES as readonly string[]).includes(value);
}

function isTruthy(value: string | undefined): boolean {
    return ["1", "true"].includes((value ?? "").toLowerCase());
}

export function profileFromEnvironment(environment: NodeJS.ProcessEnv): ToolProfile {
    const requested: string = (environment.CORONIUM_TOOL_PROFILE ?? "").trim().toLowerCase();
    if (isProfileName(requested)) return requested;
    if (requested) {
        throw new Error(`CORONIUM_TOOL_PROFILE must be one of: ${TOOL_PROFILES.join(", ")}.`);
    }
    // CORONIUM_READ_ONLY predates profiles and keeps working as an alias.
    if (isTruthy(environment.CORONIUM_READ_ONLY)) return "read-only";
    return "full";
}

export function spendingAllowed(profile: ToolProfile, spendingEnabled: boolean): boolean {
    return (profile === "full" || profile === "buyer") && spendingEnabled;
}

// Password login (coronium_login, coronium_logout) is off in every profile
// unless CORONIUM_ENABLE_LOGIN_TOOL is set, and never in directory or buyer.
// The normal way in is CORONIUM_API_TOKEN in the host configuration.
export function isToolEnabled(profile: ToolProfile, spendingEnabled: boolean, name: string, traits: ToolTraits, loginToolEnabled = false): boolean {
    if (traits.money !== "none" && !spendingAllowed(profile, spendingEnabled)) return false;
    if (traits.access === "auth" && !loginToolEnabled) return false;
    if (profile === "directory") return DIRECTORY_TOOLS.has(name);
    if (profile === "buyer") return BUYER_TOOLS.has(name);
    if (profile === "read-only") return traits.access !== "write";
    return true;
}
