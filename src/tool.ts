import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {config} from "./config.js";
import {errorDetails} from "./errors.js";
import {type Access, isToolEnabled, type MoneyEffect} from "./profiles.js";

// "METHOD /path" with :params, exactly as in test/fixtures/v3-routes.json.
export type RouteRef = `${"GET" | "POST" | "PUT" | "DELETE"} /${string}`;

interface ToolOptions<S extends z.ZodRawShape> {
    description: string;
    input: S;
    // Every backend route the tool can call. Empty for local-only tools.
    routes: readonly RouteRef[];
    output?: z.ZodTypeAny;
    access?: Access;
    money?: MoneyEffect;
    destructive?: boolean;
    idempotent?: boolean;
    run: (args: z.infer<z.ZodObject<S>>) => Promise<Record<string, unknown>>;
}

export interface ToolDefinition {
    name: string;
    access: Access;
    money: MoneyEffect;
    routes: readonly RouteRef[];
}

// Every tool the code defines, whether or not the active profile registers it.
// Tests use it to check each tool's routes against the public route fixture.
export const toolDefinitions = new Map<string, ToolDefinition>();

function title(name: string): string {
    const words = name.replace(/^coronium_/, "").replaceAll("_", " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

type Registration = () => void;

// Tools are queued per server and registered by name in finishToolRegistration,
// so tools/list returns the same order in every profile and every release,
// whatever order the modules happen to define them in.
const pendingTools = new WeakMap<McpServer, Map<string, Registration>>();

export function finishToolRegistration(server: McpServer): void {
    const pending = pendingTools.get(server);
    if (!pending) return;
    for (const name of [...pending.keys()].sort()) pending.get(name)!();
    pendingTools.delete(server);
}

export function registerTool<S extends z.ZodRawShape>(server: McpServer, name: string, options: ToolOptions<S>): void {
    const access: Access = options.access ?? "read";
    const money: MoneyEffect = options.money ?? "none";
    toolDefinitions.set(name, {name, access, money, routes: options.routes});
    if (!isToolEnabled(config.profile, config.spendingEnabled, name, {access, money}, config.loginToolEnabled)) return;
    // Money tools are always marked destructive so hosts that gate on the hint prompt.
    const destructive: boolean = money !== "none" || (options.destructive ?? false);
    const outputSchema = z.object({data: options.output ?? z.record(z.unknown()), observed_at: z.string()});
    const register: Registration = () => server.registerTool(name, {
        title: title(name),
        description: options.description,
        inputSchema: z.object(options.input).strict(),
        outputSchema,
        annotations: {title: title(name), readOnlyHint: access === "read", destructiveHint: destructive,
            idempotentHint: options.idempotent ?? access === "read", openWorldHint: true},
    }, async (args) => {
        try {
            const data = await options.run(args as z.infer<z.ZodObject<S>>);
            const result = outputSchema.parse({data, observed_at: new Date().toISOString()});
            return {content: [{type: "text", text: JSON.stringify(result)}], structuredContent: result};
        } catch (error) {
            // Error details go in the text content only. structuredContent must match
            // the tool's outputSchema, and some clients reject an error object there.
            return {isError: true, content: [{type: "text", text: JSON.stringify({error: errorDetails(error)})}]};
        }
    });
    if (!pendingTools.has(server)) pendingTools.set(server, new Map());
    pendingTools.get(server)!.set(name, register);
}

export const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Expected a 24-character modem, tariff, ticket or key ID.").transform(value => value.toLowerCase());
export const countrySchema = z.string().regex(/^[a-zA-Z]{2}$/, "Use a two-letter country code.").transform(value => value.toUpperCase());
export const usdAmount = z.number().finite().min(0).max(1_000_000);
export const paymentFields = {
    confirm: z.literal(true).describe("True only after the user authorized this exact purchase, renewal or refund, including its funding source and amount."),
    idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).describe("A unique UUID per purchase intent. Preserve it if reconciling that same intent; never reuse it for a different order."),
};
export const expectedTotalField = usdAmount.describe("The USD total the user approved, as returned by the quote. The tool re-reads the live price just before sending and refuses if the total is now different. This is a client-side check, not a server price lock.");
export const confirmation = z.literal(true).describe("True only after the user explicitly authorized this disruptive action.");
