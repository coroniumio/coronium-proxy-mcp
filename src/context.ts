import {AsyncLocalStorage} from "node:async_hooks";
import type {ToolProfile} from "./profiles.js";

// Per-request settings for the hosted (Streamable HTTP) server. One process serves
// many users there, so the profile, spending switch and bearer token of a request
// must never come from process-wide state. The stdio server never sets a context
// and keeps reading its environment exactly as before.
export type RemoteScope = "read" | "manage" | "spend";

export interface RequestContext {
    transport: "streamable-http";
    profile: ToolProfile;
    // Granted OAuth scopes, or ["read", "manage"] for a raw dashboard API token.
    scopes: readonly RemoteScope[];
    // True only when the token holds `spend` AND the user turned purchases on for
    // this connection in the dashboard. Never true on the directory resource.
    spendingEnabled: boolean;
    // The bearer for this request, forwarded to the Coronium API as-is.
    token: string;
    // Stable per connection; a raw API token uses a hash of the token.
    connectionId: string;
    auth: "oauth" | "api_token";
    resource: string;
    apiBaseUrl: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
    return storage.getStore();
}

export function runWithContext<T>(context: RequestContext, action: () => T): T {
    return storage.run(Object.freeze({...context, scopes: Object.freeze([...context.scopes])}), action);
}
