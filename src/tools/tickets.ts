// Support ticket tools. Lauren (the support AI agent) operates on the
// admin side; from the customer/MCP side these calls let an agent open
// or follow up on its own tickets without leaving the chat.

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {api} from "../api-client.js";
import {ok, err, formatTimestamp} from "../formatters.js";

export function registerTicketTools(server: McpServer) {
    server.tool(
        "coronium_list_tickets",
        "List the customer's support tickets. Returns id, subject, status, last update.",
        {
            status: z.enum(["open", "closed", "all"]).optional().default("open"),
        },
        async ({status}) => {
            try {
                const params: any = {};
                if (status && status !== "all") params.status = status;
                const list = await api.get<any[]>("/tickets", params);
                if (!Array.isArray(list) || list.length === 0) return ok("No tickets.");
                return ok(list.map((t: any) =>
                    `  ${t._id} | ${t.status?.padEnd(6) || "?"} | ${formatTimestamp(t.updatedAt || t.createdAt)} | ${t.subject || "(no subject)"}`
                ).join("\n"));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_get_ticket",
        "Get full ticket detail including all replies.",
        {
            ticket_id: z.string(),
        },
        async ({ticket_id}) => {
            try {
                const t = await api.get(`/tickets/${ticket_id}`);
                return ok(JSON.stringify(t, null, 2));
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_create_ticket",
        "Open a new support ticket.",
        {
            subject: z.string().min(3).max(200),
            message: z.string().min(3).max(8000),
            priority: z.enum(["low", "normal", "high"]).optional().default("normal"),
        },
        async ({subject, message, priority}) => {
            try {
                const r = await api.post("/tickets", {subject, message, priority});
                return ok(`✓ Ticket created\n${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_reply_to_ticket",
        "Add a reply to an existing ticket.",
        {
            ticket_id: z.string(),
            message: z.string().min(1).max(8000),
        },
        async ({ticket_id, message}) => {
            try {
                const r = await api.post(`/tickets/${ticket_id}/reply`, {message});
                return ok(`✓ Reply posted\n${JSON.stringify(r, null, 2)}`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );

    server.tool(
        "coronium_archive_ticket",
        "Archive a ticket (closes it from the customer side).",
        {
            ticket_id: z.string(),
        },
        async ({ticket_id}) => {
            try {
                await api.put(`/tickets/${ticket_id}/archive`);
                return ok(`✓ Ticket ${ticket_id} archived.`);
            } catch (e: any) {
                return err(e.message);
            }
        }
    );
}
