export type Access = "read" | "write" | "auth";
export type MoneyEffect = "none" | "spends" | "refunds";
export type ToolProfile = "full" | "directory" | "read-only";

export interface ToolTraits {
    access: Access;
    money: MoneyEffect;
}

export const TOOL_PROFILES: readonly ToolProfile[] = ["full", "directory", "read-only"];

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
    return profile === "full" && spendingEnabled;
}

export function isToolEnabled(profile: ToolProfile, spendingEnabled: boolean, name: string, traits: ToolTraits): boolean {
    if (traits.money !== "none" && !spendingAllowed(profile, spendingEnabled)) return false;
    if (profile === "directory") return DIRECTORY_TOOLS.has(name);
    if (profile === "read-only") return traits.access !== "write";
    return true;
}
