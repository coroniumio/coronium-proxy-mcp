#!/usr/bin/env node
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {createServer} from "./mcp-server.js";

// stdout belongs exclusively to the MCP JSON-RPC transport.
const server = createServer();
server.connect(new StdioServerTransport()).catch(() => {
    process.stderr.write("Coronium MCP could not start. Check its configuration.\n");
    process.exitCode = 1;
});
