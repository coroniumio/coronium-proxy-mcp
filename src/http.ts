#!/usr/bin/env node
import {createHostedServer, hostedOptionsFromEnvironment, hostedPort} from "./http-server.js";

// Hosted Streamable HTTP entry point (coronium-proxy-mcp-http). Listens on loopback
// behind the TLS proxy; see deploy/hosted/README.md. The stdio server is unchanged.
try {
    const options = hostedOptionsFromEnvironment(process.env);
    const {port, host} = hostedPort(process.env);
    const server = createHostedServer(options);
    server.requestTimeout = 250_000;
    server.headersTimeout = 30_000;
    server.listen(port, host, () => {
        process.stdout.write(JSON.stringify({ts: new Date().toISOString(), event: "listening", host, port, public_url: options.publicUrl}) + "\n");
    });
    const stop = () => server.close(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
} catch (error) {
    process.stderr.write(`Coronium hosted MCP could not start: ${error instanceof Error ? error.message : "configuration error"}\n`);
    process.exitCode = 1;
}
