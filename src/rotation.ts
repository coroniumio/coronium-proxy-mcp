import {invalidResponse} from "./errors.js";

export interface RotationResponse {
    result?: string;
    rotated?: boolean;
    pending?: boolean;
    accepted?: boolean;
    ip?: string | null;
    new_ip?: string;
    ext_ip?: string;
    message?: string;
    status_url?: string;
    retry_after_seconds?: number;
}

export type RotationResult =
    | {state: "done"; ip: string | null; response: RotationResponse}
    | {state: "rotating"; status_url: string | null; retry_after_seconds: number | null; next_step: string; response: RotationResponse}
    | {state: "unchanged"; ip: string | null; next_step: string; response: RotationResponse};

const POLL_STEP = "Rotation is in progress. Poll coronium_get_rotation_status. Do not resubmit and do not replace the proxy because of a pending rotation.";
const UNCHANGED_STEP = "The rotation ran but the carrier returned the same IP. Wait for the cooldown (about 60 seconds), then rotate again if the user still wants a new IP. Do not replace the proxy for this.";

function isPendingRotation(response: RotationResponse): boolean {
    return response.pending === true || response.accepted === true;
}

// The authenticated restart route reports rotated:true. The public
// rotate-by-token route reports success as {result:"ok", new_ip} with no
// rotated field at all, so both shapes count as completed.
function isCompletedRotation(response: RotationResponse): boolean {
    if (response.rotated === true) return true;
    if (response.rotated !== undefined) return false;
    return response.result === "ok" && typeof response.new_ip === "string" && response.new_ip !== "";
}

function reportedIp(response: RotationResponse): string | null {
    return response.new_ip ?? response.ip ?? response.ext_ip ?? null;
}

export function toRotationResult(value: unknown): RotationResult {
    if (!value || typeof value !== "object") invalidResponse("Rotation returned no result. Check rotation status before another action.");
    const response = value as RotationResponse;
    if (isCompletedRotation(response)) return {state: "done", ip: reportedIp(response), response};
    if (isPendingRotation(response)) {
        return {state: "rotating", status_url: response.status_url ?? null,
            retry_after_seconds: response.retry_after_seconds ?? null, next_step: POLL_STEP, response};
    }
    if (response.rotated === false) return {state: "unchanged", ip: reportedIp(response), next_step: UNCHANGED_STEP, response};
    invalidResponse("Rotation returned no verified result. Check rotation status before another action.");
}
