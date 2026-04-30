// Encrypted at-rest token storage at ~/.coronium/token.enc.
//
// AES-256-CBC with a scrypt-derived key. The encryption key comes from
// TOKEN_ENCRYPTION_KEY env var, or is auto-generated as a 32-byte random
// hex string per process. Auto-generation means the cache is per-machine
// and lost on restart unless TOKEN_ENCRYPTION_KEY is pinned — that's
// acceptable since auto-login (CORONIUM_LOGIN/PASSWORD) re-mints fresh
// tokens transparently.

import crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {config} from "./config.js";
import {logger} from "./logger.js";

const ALGO = "aes-256-cbc";
const CONFIG_DIR = path.join(os.homedir(), ".coronium");
const TOKEN_PATH = path.join(CONFIG_DIR, "token.enc");
const CRYPTO_ADDRS_PATH = path.join(CONFIG_DIR, "crypto_addresses.json");

class TokenStore {
    private token?: string;
    private cryptoAddresses?: Array<{coin: string, address: string, balance?: number}>;

    constructor() {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, {recursive: true});
        this.load();
        this.loadCryptoAddresses();
    }

    private encrypt(text: string): string {
        const key = crypto.scryptSync(config.tokenEncryptionKey, "salt", 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGO, key, iv);
        const enc = cipher.update(text, "utf8", "hex") + cipher.final("hex");
        return iv.toString("hex") + ":" + enc;
    }

    private decrypt(text: string): string | null {
        try {
            const key = crypto.scryptSync(config.tokenEncryptionKey, "salt", 32);
            const [ivHex, encHex] = text.split(":");
            if (!ivHex || !encHex) return null;
            const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
            return decipher.update(encHex, "hex", "utf8") + decipher.final("utf8");
        } catch {
            return null;
        }
    }

    get(): string | undefined { return this.token; }

    set(token: string): void {
        this.token = token;
        try {
            fs.writeFileSync(TOKEN_PATH, this.encrypt(token), "utf8");
            logger.debug("Token stored");
        } catch (e) {
            logger.error("Failed to persist token:", e);
        }
    }

    clear(): void {
        this.token = undefined;
        try {
            if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
        } catch (e) {
            logger.debug("Token clear noop:", e);
        }
    }

    private load(): void {
        if (!fs.existsSync(TOKEN_PATH)) return;
        try {
            const enc = fs.readFileSync(TOKEN_PATH, "utf8");
            if (enc) {
                const dec = this.decrypt(enc);
                if (dec) this.token = dec;
            }
        } catch {
            // unreadable cache — fine, next call will re-mint
        }
    }

    getCryptoAddresses() { return this.cryptoAddresses; }

    saveCryptoAddresses(addresses: Array<{coin: string, address: string, balance?: number}>): void {
        this.cryptoAddresses = addresses;
        try {
            fs.writeFileSync(CRYPTO_ADDRS_PATH, JSON.stringify(addresses, null, 2));
        } catch (e) {
            logger.error("Failed to save crypto addresses:", e);
        }
    }

    private loadCryptoAddresses(): void {
        if (!fs.existsSync(CRYPTO_ADDRS_PATH)) return;
        try {
            this.cryptoAddresses = JSON.parse(fs.readFileSync(CRYPTO_ADDRS_PATH, "utf8"));
        } catch {/* ignore */}
    }
}

export const tokenStore = new TokenStore();
