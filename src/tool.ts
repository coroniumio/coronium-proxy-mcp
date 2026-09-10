import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {config} from "./config.js";
import {errorDetails} from "./errors.js";

type Access = "read" | "write" | "auth";
interface ToolOptions<S extends z.ZodRawShape> {
    description: string;
    input: S;
    output?: z.ZodTypeAny;
    access?: Access;
    destructive?: boolean;
    idempotent?: boolean;
    run: (args: z.infer<z.ZodObject<S>>) => Promise<Record<string, unknown>>;
}

export function registerTool<S extends z.ZodRawShape>(server: McpServer, name: string, options: ToolOptions<S>): void {
    const access = options.access ?? "read";
    if (config.readOnly && access === "write") return;
    const outputSchema = z.object({data: options.output ?? z.record(z.unknown()), observed_at: z.string()});
    server.registerTool(name, {
        title: name.replace(/^coronium_/, "").replaceAll("_", " "),
        description: options.description,
        inputSchema: z.object(options.input).strict(),
        outputSchema,
        annotations: {readOnlyHint: access === "read", destructiveHint: options.destructive ?? false,
            idempotentHint: options.idempotent ?? access === "read", openWorldHint: true},
    }, async (args) => {
        try {
            const data = await options.run(args as z.infer<z.ZodObject<S>>);
            const result = outputSchema.parse({data, observed_at: new Date().toISOString()});
            return {content: [{type: "text", text: JSON.stringify(result)}], structuredContent: result};
        } catch (error) {
            const result = {error: errorDetails(error)};
            return {isError: true, content: [{type: "text", text: JSON.stringify(result)}], structuredContent: result};
        }
    });
}

export const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Expected a 24-character modem, tariff, ticket or key ID.").transform(value => value.toLowerCase());
export const countrySchema = z.string().regex(/^[a-zA-Z]{2}$/, "Use a two-letter country code.").transform(value => value.toUpperCase());
export const paymentFields = {
    confirm: z.literal(true).describe("True only after the user authorized this purchase or renewal, including its funding source."),
    idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).describe("A unique UUID per purchase intent. Preserve it if reconciling/retrying that same intent; never reuse it for a different order."),
};
export const confirmation = z.literal(true).describe("True only after the user explicitly authorized this disruptive action.");
