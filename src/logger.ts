// Console logger. Writes to stderr exclusively — stdout is reserved for
// MCP JSON-RPC traffic, so any stdout writes corrupt the protocol.

import {config} from "./config.js";

type LogLevel = "error" | "warn" | "info" | "debug";

class Logger {
    private levels: Record<LogLevel, number> = {error: 0, warn: 1, info: 2, debug: 3};
    private currentLevel: number;

    constructor(level: string = "info") {
        this.currentLevel = this.levels[level as LogLevel] ?? this.levels.info;
    }

    error(...args: any[]) { if (this.currentLevel >= 0) console.error("[ERROR]", ...args); }
    warn(...args: any[])  { if (this.currentLevel >= 1) console.error("[WARN]", ...args); }
    info(...args: any[])  { if (this.currentLevel >= 2) console.error("[INFO]", ...args); }
    debug(...args: any[]) { if (this.currentLevel >= 3) console.error("[DEBUG]", ...args); }
}

export const logger = new Logger(config.logLevel);
