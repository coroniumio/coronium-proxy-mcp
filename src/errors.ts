export type Outcome = "unknown" | "refunded_not_charged";

export interface ErrorDetails {
    status?: number;
    code: string;
    backend_code?: string;
    message: string;
    suggested_action?: string;
    request_id?: string;
    retry_after_seconds?: number;
    idempotency_key?: string;
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

export function errorDetails(error: unknown): ErrorDetails {
    if (error instanceof CoroniumError) return redact(error.details) as ErrorDetails;
    const message = error instanceof Error ? error.message : "The tool failed.";
    return {code: "tool_error", message: String(redact(message)), suggested_action: "review_request"};
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

// Classify by HTTP status and body fields first and by code last: the live error
// envelope rewrites codes it does not know (for example rotation_cooldown) to
// internal_error or to a misleading "rotation in progress".
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
