export type Outcome = "unknown" | "refunded_not_charged";

export interface ErrorDetails {
    status?: number;
    code: string;
    backend_code?: string;
    message: string;
    suggested_action?: string;
    // One plain sentence telling the agent what to do next.
    recovery_hint?: string;
    request_id?: string;
    retry_after_seconds?: number;
    idempotency_key?: string;
    // The backend's payment ID when it has one: poll it, never pay again.
    payment_id?: string;
    outcome?: Outcome;
    details?: unknown;
}

export class CoroniumError extends Error {
    constructor(public readonly details: ErrorDetails) {
        super(details.message);
        this.name = "CoroniumError";
    }
}

export function invalidResponse(message: string): never {
    throw new CoroniumError({code: "invalid_response", message, suggested_action: "contact_support"});
}

export function redact(value: unknown): unknown {
    if (typeof value === "string") {
        return value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/([?&](?:auth_token|token|api_key)=)[^&\s]+/gi, "$1[redacted]")
            .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]");
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
            /password|token|authorization|secret|signature|api.?key/i.test(key) ? "[redacted]" : redact(item)]));
    }
    return value;
}

const DASHBOARD = "https://dashboard.coronium.io";

const HINTS_BY_ACTION: Readonly<Record<string, string>> = {
    authenticate: `Set CORONIUM_API_TOKEN in the MCP host configuration (create it at ${DASHBOARD}, Account, API Access) and restart the MCP.`,
    check_rotation_status: "Call coronium_get_rotation_status for this proxy and wait for state done or unchanged. Do not rotate again or replace the proxy yet.",
    check_state_before_retrying: "The outcome is unclear. Check coronium_get_payment_status, coronium_get_proxies or coronium_get_balance before doing anything else, and do not repeat the request.",
    confirm_without_coupon: "Tell the user the coupon gives no discount now and ask whether to continue at the full price.",
    contact_support: `Nothing more to try from here. Open a ticket at ${DASHBOARD} and quote request_id if there is one.`,
    list_owned_proxies: "Call coronium_get_proxies to see which proxies this account owns, then retry with one of those.",
    list_pool_tariffs: "Call coronium_list_pool_tariffs for the current pay-per-GB plans and pick one of those.",
    list_tariffs: "Call coronium_list_tariffs or coronium_list_free_modems for live stock and pick a plan that is in stock.",
    nothing_was_charged_choose_another_plan_or_retry_later: "Nothing was charged and the amount is back on the balance. Pick another plan from coronium_list_tariffs, or try again after retry_after_seconds.",
    preview_and_confirm_again: "Run the preview again, show the user the new figure and ask again before acting.",
    requote_and_confirm: "Call coronium_quote_purchase (or coronium_get_renewal_quote for renewals), show the user the new total and ask again.",
    review_request: "Check the arguments against the tool's input schema and try again.",
    use_dashboard: `This MCP is not set up to spend. The user can pay at ${DASHBOARD}, or the host can set CORONIUM_ENABLE_SPENDING=1 with the full or buyer profile.`,
    wait_for_previous_result: "Wait for the earlier call on this proxy to return before acting again.",
    wait_retry_after_seconds: "Wait retry_after_seconds, then try once more.",
    wait_retry_after_then_check_rotation_status: "Wait retry_after_seconds, then call coronium_get_rotation_status. Do not replace the proxy because of a cooldown.",
};

const HINTS_BY_CODE: Readonly<Record<string, string>> = {
    insufficient_balance: `The balance is too low for this total. A person can add funds at ${DASHBOARD}, or send BTC to the deposit address from coronium_get_crypto_balance and pay with funding_source btc once it confirms. Then quote again.`,
    insufficient_funds: `The balance is too low for this total. A person can add funds at ${DASHBOARD}, or send BTC to the deposit address from coronium_get_crypto_balance and pay with funding_source btc once it confirms. Then quote again.`,
    out_of_stock: "That plan just sold out. Call coronium_list_free_modems for live counts and coronium_list_tariffs for plans in stock.",
    no_stock: "That plan just sold out. Call coronium_list_free_modems for live counts and coronium_list_tariffs for plans in stock.",
    duplicate_request: "This idempotency key was already used. Reconcile with coronium_get_payment_status or coronium_get_proxies; never buy again with a new key.",
    payment_delivery_unconfirmed: "The payment went through but delivery is not confirmed yet. Poll coronium_get_payment_status and coronium_get_proxies. Never order again.",
    not_authenticated: HINTS_BY_ACTION.authenticate,
};

const FALLBACK_HINT = "Read error.message. Do not repeat a write automatically.";

export function recoveryHint(details: ErrorDetails): string {
    if (details.recovery_hint) return details.recovery_hint;
    if (details.outcome === "refunded_not_charged") return HINTS_BY_ACTION.nothing_was_charged_choose_another_plan_or_retry_later;
    if (details.outcome === "unknown") return HINTS_BY_ACTION.check_state_before_retrying;
    return HINTS_BY_CODE[details.code]
        ?? (details.status === 402 ? HINTS_BY_CODE.insufficient_balance : undefined)
        ?? (details.suggested_action ? HINTS_BY_ACTION[details.suggested_action] : undefined)
        ?? FALLBACK_HINT;
}

export function errorDetails(error: unknown): ErrorDetails {
    if (error instanceof CoroniumError) {
        const details = redact(error.details) as ErrorDetails;
        return {...details, recovery_hint: recoveryHint(details)};
    }
    const message = error instanceof Error ? error.message : "The tool failed.";
    const details: ErrorDetails = {code: "tool_error", message: String(redact(message)), suggested_action: "review_request"};
    return {...details, recovery_hint: recoveryHint(details)};
}

// The backend mixes lowercase codes with uppercase ones such as
// PAYMENT_IN_PROGRESS or OUT_OF_STOCK. Agents get one lowercase vocabulary.
export function normalizeErrorCode(code: unknown): string | undefined {
    if (typeof code !== "string" || !code.trim()) return undefined;
    return code.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function secondsFromHeader(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const text = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    const date = Date.parse(text);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function secondsFromNumber(value: unknown): number | undefined {
    const number = Number(value);
    if (value === undefined || value === null || value === "" || !Number.isFinite(number) || number < 0) return undefined;
    return number;
}

// Some rotation refusals carry the wait only in their text:
// "Please wait 42 more seconds to rotate".
function secondsFromMessage(message: unknown): number | undefined {
    const match = /wait\s+(\d+)\s+more\s+seconds?/i.exec(String(message ?? ""));
    if (!match) return undefined;
    return Number(match[1]);
}

export function retryAfterSeconds(header: unknown, body: Record<string, any>): number | undefined {
    return secondsFromHeader(header)
        ?? secondsFromNumber(body.retry_after_seconds)
        ?? secondsFromNumber(body.retryAfter)
        ?? secondsFromMessage(body.error ?? body.message);
}

export interface ErrorContext {
    status: number;
    body: Record<string, any>;
    // True for the restart and rotate-by-token routes.
    rotation: boolean;
    mutates: boolean;
}

export interface Classification {
    code: string;
    suggested_action?: string;
    outcome?: Outcome;
}

function isRotationFailure(context: ErrorContext): boolean {
    if (!context.rotation || context.status < 500) return false;
    return context.body.result === "error" || /rotat/i.test(String(context.body.error ?? ""));
}

// Classify by HTTP status and body fields first and by code last: on some
// routes the code is generic (internal_error) or does not describe the refusal,
// so it is kept as backend_code but never decides the agent's next step alone.
export function classifyError(context: ErrorContext): Classification {
    const backendCode: string | undefined = normalizeErrorCode(context.body.code);
    if (context.status === 429 && context.rotation) {
        return {code: "rotation_cooldown", suggested_action: "wait_retry_after_then_check_rotation_status"};
    }
    if (context.status === 429) {
        const code = backendCode && backendCode !== "internal_error" ? backendCode : "rate_limited";
        return {code, suggested_action: "wait_retry_after_seconds"};
    }
    if (context.body.refunded === true) {
        const code = backendCode && backendCode !== "internal_error" ? backendCode : "purchase_refunded";
        return {code, suggested_action: "nothing_was_charged_choose_another_plan_or_retry_later", outcome: "refunded_not_charged"};
    }
    if (isRotationFailure(context)) {
        return {code: "rotation_failed", suggested_action: "check_rotation_status", outcome: context.mutates ? "unknown" : undefined};
    }
    const code: string = backendCode ?? `http_${context.status}`;
    if (context.mutates && context.status >= 500) {
        return {code, suggested_action: "check_state_before_retrying", outcome: "unknown"};
    }
    return {code, suggested_action: typeof context.body.suggested_action === "string" ? context.body.suggested_action : undefined};
}
