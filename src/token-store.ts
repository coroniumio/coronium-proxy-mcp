import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {config} from "./config.js";

// Environment tokens stay in memory. Login tokens persist only with an explicitly
// configured encryption key; a random per-process key cannot protect a reusable cache.
class TokenStore {
    private token?: string;
    private readonly directory = path.join(os.homedir(), ".coronium");
    private readonly file = path.join(this.directory, "token.enc");

    constructor() {
        this.token = config.apiToken || this.load();
    }

    get(): string | undefined { return this.token; }

    set(token: string): void {
        this.token = token;
        if (!config.tokenEncryptionKey) return;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.key(), iv);
        const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
        const encoded = ["gcm", iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(":");
        fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
        fs.chmodSync(this.directory, 0o700);
        const temporary = this.file + "." + crypto.randomUUID();
        try {
            fs.writeFileSync(temporary, encoded, {mode: 0o600, flag: "wx"});
            fs.renameSync(temporary, this.file);
        } finally {
            fs.rmSync(temporary, {force: true});
        }
    }

    clear(): void {
        this.token = undefined;
        fs.rmSync(this.file, {force: true});
    }

    private key(): Buffer {
        return crypto.scryptSync(config.tokenEncryptionKey!, "salt", 32);
    }

    private load(): string | undefined {
        if (!config.tokenEncryptionKey || !fs.existsSync(this.file)) return undefined;
        try {
            const parts = fs.readFileSync(this.file, "utf8").split(":");
            if (parts[0] === "gcm") {
                const decipher = crypto.createDecipheriv("aes-256-gcm", this.key(), Buffer.from(parts[1], "hex"));
                decipher.setAuthTag(Buffer.from(parts[2], "hex"));
                return decipher.update(parts[3], "hex", "utf8") + decipher.final("utf8");
            }
            // Read a pinned-key v1 cache; the next explicit login writes GCM.
            const decipher = crypto.createDecipheriv("aes-256-cbc", this.key(), Buffer.from(parts[0], "hex"));
            return decipher.update(parts[1], "hex", "utf8") + decipher.final("utf8");
        } catch {
            return undefined;
        }
    }
}

export const tokenStore = new TokenStore();
