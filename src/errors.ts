export interface ErrorDetails {
    status?: number;
    code: string;
    message: string;
    suggested_action?: string;
    request_id?: string;
    retry_after_seconds?: number;
    idempotency_key?: string;
    outcome?: "unknown";
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
    return {code: "tool_error", message: String(redact(error instanceof Error ? error.message : "The tool failed.")), suggested_action: "review_request"};
}
