#!/usr/bin/env node

// Coronium MCP server — entrypoint.
//
// All tool surface lives in src/tools/. This file just wires up the MCP
// transport, registers tools by category, and reports startup state to
// stderr so MCP hosts (Claude Desktop, Cursor, Cline, etc.) can show a
// clean boot log without polluting the JSON-RPC stream on stdout.
//
// See README.md for tool catalog and configuration.

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {SERVER_NAME, SERVER_VERSION, config} from "./config.js";
import {logger} from "./logger.js";
import {registerAuthTools} from "./tools/auth.js";
import {registerAccountTools} from "./tools/account.js";
import {registerProxyTools} from "./tools/proxies.js";
import {registerShopTools} from "./tools/shop.js";
import {registerTicketTools} from "./tools/tickets.js";

async function main() {
    const server = new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    });

    registerAuthTools(server);
    registerAccountTools(server);
    registerProxyTools(server);
    registerShopTools(server);
    registerTicketTools(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info(`Coronium MCP v${SERVER_VERSION} ready`);
    logger.info(`  api v1: ${config.baseUrl}`);
    logger.info(`  api v3: ${config.baseUrlV3}`);
    if (config.login && config.password) {
        logger.info(`  auto-login: ON (CORONIUM_LOGIN=${config.login})`);
    } else {
        logger.info(`  auto-login: OFF (set CORONIUM_LOGIN/CORONIUM_PASSWORD or call coronium_login)`);
    }
}

main().catch((e) => {
    logger.error("Fatal:", e);
    process.exit(1);
});
