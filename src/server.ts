#!/usr/bin/env node

/**
 * Coronium MCP Server
 * 
 * A Model Context Protocol (MCP) server for interacting with the Coronium.io mobile proxy service.
 * This server provides tools for authentication, proxy management, balance checking, and payment methods.
 * 
 * @version 1.0.0
 * @license MIT
 * @see https://github.com/coronium/coronium-proxy-mcp
 */

import "dotenv/config";
import axios, { AxiosInstance, AxiosError } from "axios";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ===========================================
// Configuration
// ===========================================

/**
 * Server configuration loaded from environment variables
 * Falls back to defaults where appropriate
 */
const config = {
  baseUrl: process.env.CORONIUM_BASE_URL || "https://api.coronium.io/v1",
  login: process.env.CORONIUM_LOGIN,
  password: process.env.CORONIUM_PASSWORD,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
  logLevel: process.env.LOG_LEVEL || "info"
};

// ===========================================
// Logger
// ===========================================

type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Simple logger implementation with configurable log levels
 * Outputs to stderr to avoid interfering with MCP communication on stdout
 */
class Logger {
  private levels: Record<LogLevel, number> = { 
    error: 0, 
    warn: 1, 
    info: 2, 
    debug: 3 
  };
  private currentLevel: number;

  constructor(level: string = "info") {
    this.currentLevel = this.levels[level as LogLevel] ?? 2;
  }

  error(...args: any[]) {
    if (this.currentLevel >= 0) console.error("[ERROR]", ...args);
  }

  warn(...args: any[]) {
    if (this.currentLevel >= 1) console.error("[WARN]", ...args);
  }

  info(...args: any[]) {
    if (this.currentLevel >= 2) console.error("[INFO]", ...args);
  }

  debug(...args: any[]) {
    if (this.currentLevel >= 3) console.error("[DEBUG]", ...args);
  }
}

const logger = new Logger(config.logLevel);

// ===========================================
// Token Storage
// ===========================================

/**
 * Manages secure storage of authentication tokens and crypto addresses
 * 
 * Features:
 * - AES-256-CBC encryption for token storage
 * - Persistent storage in ~/.coronium directory
 * - Automatic loading on startup
 * - Crypto address caching for payment operations
 */
class TokenStore {
  private token?: string;
  private tokenPath: string;
  private cryptoAddressesPath: string;
  private encryptionKey: string;
  private cryptoAddresses?: Array<{coin: string, address: string, balance?: number}>;

  constructor() {
    const configDir = join(homedir(), ".coronium");
    this.tokenPath = join(configDir, "token.enc");
    this.cryptoAddressesPath = join(configDir, "crypto_addresses.json");
    this.encryptionKey = config.tokenEncryptionKey;
    
    // Create config directory if needed
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      logger.debug("Created config directory:", configDir);
    }
    
    // Load existing token and crypto addresses if available
    this.load();
    this.loadCryptoAddresses();
  }

  /**
   * Encrypts text using AES-256-CBC
   * @param text Plain text to encrypt
   * @returns Encrypted text with IV prepended
   */
  private encrypt(text: string): string {
    const algorithm = "aes-256-cbc";
    const key = crypto.scryptSync(this.encryptionKey, "salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const result = iv.toString("hex") + ":" + encrypted;
    return result;
  }

  /**
   * Decrypts text encrypted with encrypt()
   * @param text Encrypted text with IV
   * @returns Decrypted plain text or null if decryption fails
   */
  private decrypt(text: string): string | null {
    try {
      const algorithm = "aes-256-cbc";
      const key = crypto.scryptSync(this.encryptionKey, "salt", 32);
      const parts = text.split(":");
      if (parts.length !== 2) return null;
      
      const iv = Buffer.from(parts[0], "hex");
      const encryptedText = parts[1];
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedText, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (error) {
      logger.debug("Failed to decrypt token:", error);
      return null;
    }
  }

  /**
   * Gets the stored authentication token
   * @returns Token string or undefined if not available
   */
  get(): string | undefined {
    return this.token;
  }

  /**
   * Gets stored crypto addresses for payment operations
   * @returns Array of crypto addresses or undefined
   */
  getCryptoAddresses(): Array<{coin: string, address: string, balance?: number}> | undefined {
    return this.cryptoAddresses;
  }

  /**
   * Saves crypto addresses to disk for future reference
   * @param addresses Array of crypto addresses from API
   */
  saveCryptoAddresses(addresses: Array<{coin: string, address: string, balance?: number}>): void {
    try {
      this.cryptoAddresses = addresses;
      const configDir = join(homedir(), ".coronium");
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      writeFileSync(this.cryptoAddressesPath, JSON.stringify(addresses, null, 2));
      logger.info(`Saved ${addresses.length} crypto addresses to disk`);
    } catch (error) {
      logger.error("Failed to save crypto addresses:", error);
    }
  }

  /**
   * Loads crypto addresses from disk
   */
  loadCryptoAddresses(): void {
    try {
      if (existsSync(this.cryptoAddressesPath)) {
        const data = readFileSync(this.cryptoAddressesPath, "utf8");
        this.cryptoAddresses = JSON.parse(data);
        logger.debug(`Loaded ${this.cryptoAddresses?.length || 0} crypto addresses from disk`);
      }
    } catch (error) {
      logger.debug("Failed to load crypto addresses:", error);
    }
  }

  /**
   * Sets and saves a new authentication token
   * @param token Authentication token from API
   */
  set(token: string): void {
    logger.debug("Setting token:", token.substring(0, 10) + "...");
    this.token = token;
    this.save();
    logger.info("Token stored securely");
  }

  /**
   * Clears the stored token
   */
  clear(): void {
    logger.warn("Clearing stored token");
    this.token = undefined;
    if (existsSync(this.tokenPath)) {
      try {
        writeFileSync(this.tokenPath, "");
        logger.debug("Token file cleared");
      } catch (error) {
        logger.error("Failed to clear token file:", error);
      }
    }
  }

  /**
   * Saves the current token to disk (encrypted)
   */
  private save(): void {
    if (this.token) {
      try {
        logger.debug("Saving token to disk...");
        const encrypted = this.encrypt(this.token);
        logger.debug("Encrypted token length:", encrypted.length);
        writeFileSync(this.tokenPath, encrypted, "utf8");
        logger.debug("Token saved to:", this.tokenPath);
      } catch (error) {
        logger.error("Failed to save token:", error);
      }
    } else {
      logger.warn("No token to save");
    }
  }

  /**
   * Loads token from disk and decrypts it
   */
  private load(): void {
    if (existsSync(this.tokenPath)) {
      try {
        const encrypted = readFileSync(this.tokenPath, "utf8");
        if (encrypted) {
          const decrypted = this.decrypt(encrypted);
          if (decrypted) {
            this.token = decrypted;
            logger.debug("Token loaded from disk");
          }
        }
      } catch (error) {
        logger.debug("No existing token found");
      }
    }
  }
}

// ===========================================
// API Client
// ===========================================

/**
 * Coronium API client for interacting with the proxy service
 * Handles authentication, proxy listing, balance checking, and payment methods
 */
class CoroniumAPI {
  private client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json"
      }
    });

    logger.debug("API client initialized:", baseUrl);
  }

  /**
   * Authenticates with Coronium API and obtains access token
   * @param login User email
   * @param password User password
   * @returns Authentication token
   */
  async getToken(login: string, password: string): Promise<string> {
    try {
      logger.info("Authenticating with Coronium API...");
      const response = await this.client.post("/get-token", {
        login,
        password
      });

      if (response.data?.token) {
        logger.info("Authentication successful");
        return response.data.token;
      }

      throw new Error("No token received from API");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error || error.message;
        
        if (status === 401) {
          throw new Error("Invalid credentials. Please check your email and password.");
        } else if (status === 429) {
          throw new Error("Rate limit exceeded. Please wait before trying again.");
        } else if (status) {
          throw new Error(`Authentication failed (${status}): ${message}`);
        }
      }
      throw new Error(`Authentication failed: ${error}`);
    }
  }

  /**
   * Validates an authentication token
   * @param token Authentication token to check
   * @returns True if token is valid, false otherwise
   */
  async checkToken(token: string): Promise<boolean> {
    try {
      logger.debug("Checking token validity using account/proxies endpoint...");
      
      // Use a lightweight API call to validate the token
      // The proxies endpoint will return 401 if token is invalid
      const response = await this.client.get("/account/proxies", {
        params: {
          auth_token: token
        },
        timeout: 5000 // Short timeout for validation
      });

      // If we get a successful response, token is valid
      if (response.status === 200) {
        logger.info("Token is valid");
        return true;
      }

      return false;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        
        // 401 or 403 means token is definitely invalid
        if (status === 401 || status === 403) {
          logger.debug("Token is invalid or expired");
          return false;
        }
      }
      
      // For any other error, we can't determine validity
      // Return false to be safe
      logger.debug("Token check failed - unable to verify");
      return false;
    }
  }

  /**
   * Fetches list of user's mobile proxies
   * @param token Authentication token
   * @returns Array of proxy configurations
   */
  async getProxies(token: string): Promise<any> {
    try {
      logger.info("Fetching account proxies...");
      const response = await this.client.get("/account/proxies", {
        params: {
          auth_token: token
        }
      });

      if (response.data?.data) {
        logger.info(`Retrieved ${response.data.data.length} proxies`);
        return response.data.data;
      }

      return [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error || error.message;
        
        if (status === 401) {
          throw new Error("Authentication failed. Token may be invalid or expired.");
        } else if (status === 403) {
          throw new Error("Access denied. Please check your permissions.");
        } else if (status) {
          throw new Error(`Failed to fetch proxies (${status}): ${message}`);
        }
      }
      throw new Error(`Failed to fetch proxies: ${error}`);
    }
  }

  /**
   * Fetches cryptocurrency balance and payment addresses
   * @param token Authentication token
   * @returns Array of crypto accounts with balances and addresses
   */
  async getCryptoBalance(token: string): Promise<any> {
    try {
      logger.info("Fetching crypto balance...");
      const response = await this.client.get("/account/crypto-balance", {
        params: {
          auth_token: token
        }
      });

      // API returns array directly: [{coin: "btc", balance: 0, address: "bc1q..."}, ...]
      if (Array.isArray(response.data)) {
        logger.info(`Retrieved balance for ${response.data.length} cryptocurrency account(s)`);
        return response.data;
      }

      logger.warn(`Unexpected crypto response format:`, response.data);
      return [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error || error.message;
        
        if (status === 401) {
          throw new Error("Authentication failed. Token may be invalid or expired.");
        } else if (status === 403) {
          throw new Error("Access denied. Please check your permissions.");
        } else if (status) {
          throw new Error(`Failed to fetch crypto balance (${status}): ${message}`);
        }
      }
      throw new Error(`Failed to fetch crypto balance: ${error}`);
    }
  }

  /**
   * Fetches saved credit cards for the account
   * @param token Authentication token
   * @returns Array of saved credit card information
   */
  async getCreditCards(token: string): Promise<any> {
    try {
      logger.info("Fetching saved credit cards...");
      const response = await this.client.get("/account/card-list", {
        params: {
          auth_token: token
        }
      });
      
      if (response.data?.data) {
        logger.info(`Found ${response.data.data.length} saved card(s)`);
        return response.data.data;
      }
      
      return [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error || error.message;
        
        if (status === 401) {
          throw new Error("Authentication required. Please use coronium_get_token first.");
        } else if (status) {
          throw new Error(`Failed to fetch cards (${status}): ${message}`);
        }
      }
      throw new Error(`Failed to fetch cards: ${error}`);
    }
  }
}

// ===========================================
// Input Validation Schemas
// ===========================================

/**
 * Zod schemas for validating tool inputs
 */
const GetTokenArgsSchema = z.object({
  login: z.string().email().optional(),
  password: z.string().min(1).optional()
});

const CheckTokenArgsSchema = z.object({
  token: z.string().min(1).optional()
});

const GetProxiesArgsSchema = z.object({
  token: z.string().min(1).optional()
});

const GetCryptoBalanceArgsSchema = z.object({
  token: z.string().min(1).optional()
});

const GetCreditCardsArgsSchema = z.object({
  token: z.string().min(1).optional()
});

// ===========================================
// MCP Server Setup
// ===========================================

/**
 * Main server initialization and tool registration
 */
async function main() {
  logger.info("Starting Coronium MCP Server v1.0.0");
  
  // Initialize components
  const tokenStore = new TokenStore();
  const api = new CoroniumAPI(config.baseUrl);
  
  // Create MCP server
  const server = new McpServer(
    {
      name: "coronium-mcp-server",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  /**
   * Tool: coronium_get_token
   * Authenticates with Coronium API and stores token securely
   */
  server.tool(
    "coronium_get_token",
    "🔐 ALWAYS RUN THIS FIRST - Authenticates with Coronium and stores token for 30 days. Required before using ANY other Coronium tools. Uses CORONIUM_EMAIL and CORONIUM_PASSWORD from environment. No parameters needed - just call it.",
    async (args: any) => {
      // Validate input
      const parsed = GetTokenArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{
            type: "text",
            text: `Invalid input: ${parsed.error.errors.map(e => e.message).join(", ")}`
          }]
        };
      }

      // Get credentials (prefer args over env vars)
      const login = parsed.data.login || config.login;
      const password = parsed.data.password || config.password;

      // Validate we have credentials
      if (!login || !password) {
        return {
          content: [{
            type: "text",
            text: "Missing credentials. Please provide login and password, or set CORONIUM_LOGIN and CORONIUM_PASSWORD environment variables."
          }]
        };
      }

      // Validate email format
      if (!z.string().email().safeParse(login).success) {
        return {
          content: [{
            type: "text",
            text: "Invalid email format for login."
          }]
        };
      }

      try {
        // Get token from API
        const token = await api.getToken(login, password);
        
        logger.debug("Token received from API:", token ? "Yes (" + token.length + " chars)" : "No");
        
        // Store token securely
        tokenStore.set(token);
        
        logger.debug("Token stored, checking if it's retrievable:", tokenStore.get() ? "Yes" : "No");

        return {
          content: [{
            type: "text",
            text: "✅ Authentication successful! Token has been obtained and stored securely.\n\nYou can now use other Coronium tools that require authentication."
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );

  /**
   * Tool: coronium_check_token
   * Validates the stored authentication token
   */
  server.tool(
    "coronium_check_token",
    "✅ Verifies if authentication is still valid. Use this if unsure whether authenticated. If returns false, run coronium_get_token first. Useful for debugging auth issues.",
    async (args: any) => {
      // Validate input
      const parsed = CheckTokenArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{
            type: "text",
            text: `Invalid input: ${parsed.error.errors.map(e => e.message).join(", ")}`
          }]
        };
      }

      // Get token (prefer args over stored)
      const token = parsed.data.token || tokenStore.get();

      if (!token) {
        return {
          content: [{
            type: "text",
            text: "❌ No token available. Please authenticate first using coronium_get_token."
          }]
        };
      }

      try {
        // Check token validity
        const isValid = await api.checkToken(token);

        if (isValid) {
          return {
            content: [{
              type: "text",
              text: "✅ Token is valid and active. Authentication is working correctly."
            }]
          };
        } else {
          // Don't auto-clear token - let user decide
          return {
            content: [{
              type: "text",
              text: "❌ Token is invalid or expired. Please authenticate again using coronium_get_token."
            }]
          };
        }
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to check token: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );

  /**
   * Tool: coronium_get_proxies
   * Fetches and displays user's mobile proxies with connection details
   */
  server.tool(
    "coronium_get_proxies",
    "📡 Lists all mobile proxies with ready-to-use connection strings (HTTP/SOCKS5). REQUIRES AUTHENTICATION: If this fails with 'No token', run coronium_get_token first. Returns proxy IPs, ports, credentials, and status.",
    async (args: any) => {
      // Validate input
      const parsed = GetProxiesArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{
            type: "text",
            text: `Invalid input: ${parsed.error.errors.map(e => e.message).join(", ")}`
          }]
        };
      }

      // Get token (prefer args over stored)
      const token = parsed.data.token || tokenStore.get();

      if (!token) {
        return {
          content: [{
            type: "text",
            text: "❌ No token available. Please authenticate first using coronium_get_token."
          }]
        };
      }

      try {
        // Fetch proxies from API
        const proxies = await api.getProxies(token);

        if (!proxies || proxies.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No proxies found in your account."
            }]
          };
        }

        // Format proxy information
        let output = `🔌 **Found ${proxies.length} Proxy Connection(s):**\n\n`;
        
        proxies.forEach((proxy: any, index: number) => {
          const httpPort = proxy.http_port || 8080;
          const socks5Port = proxy.socks_port || (parseInt(httpPort) + 1000);
          const connectionIP = proxy.ip_address || proxy.ext_ip || 'N/A';
          const username = proxy.proxy_login || 'N/A';
          const password = proxy.proxy_password || 'N/A';
          
          output += `**Proxy ${index + 1}: ${proxy.name || 'Unnamed'}**\n`;
          output += `├─ Connection IP: ${connectionIP}\n`;
          output += `├─ HTTP Port: ${httpPort}\n`;
          output += `├─ SOCKS5 Port: ${socks5Port}\n`;
          output += `├─ Username: ${username}\n`;
          output += `├─ Password: ${password}\n`;
          
          if (proxy.ext_ip) {
            output += `├─ External IP: ${proxy.ext_ip}\n`;
          }
          
          if (proxy.isOnline !== undefined) {
            output += `├─ Status: ${proxy.isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
          }
          
          if (proxy.rotated_at) {
            const rotatedDate = new Date(proxy.rotated_at);
            output += `├─ Last Rotated: ${rotatedDate.toLocaleString()}\n`;
          }
          
          if (proxy.rotation_interval !== undefined) {
            output += `├─ Rotation Interval: ${proxy.rotation_interval === 0 ? 'Manual' : `${proxy.rotation_interval} minutes`}\n`;
          }
          
          output += `\n`;
          
          // Add connection strings for easy copying
          output += `**Connection Strings:**\n`;
          output += `HTTP: http://${username}:${password}@${connectionIP}:${httpPort}\n`;
          output += `SOCKS5: socks5://${username}:${password}@${connectionIP}:${socks5Port}\n`;
          
          if (index < proxies.length - 1) {
            output += `\n${"─".repeat(50)}\n\n`;
          }
        });

        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to fetch proxies: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );

  /**
   * Tool: coronium_get_crypto_balance
   * Fetches cryptocurrency balances and payment addresses
   */
  server.tool(
    "coronium_get_crypto_balance",
    "💰 Shows crypto balances (BTC/USDT) and deposit addresses. REQUIRES AUTHENTICATION: If this fails, run coronium_get_token first. Addresses are saved locally for reference.",
    async (args: any) => {
      // Validate input
      const parsed = GetCryptoBalanceArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{
            type: "text",
            text: `Invalid input: ${parsed.error.errors.map(e => e.message).join(", ")}`
          }]
        };
      }

      // Get token (prefer args over stored)
      const token = parsed.data.token || tokenStore.get();

      if (!token) {
        return {
          content: [{
            type: "text",
            text: "❌ No token available. Please authenticate first using coronium_get_token."
          }]
        };
      }

      try {
        // Fetch crypto balance from API
        const balances = await api.getCryptoBalance(token);
        
        logger.debug(`Crypto balance response:`, balances);

        if (!balances || balances.length === 0) {
          return {
            content: [{
              type: "text",
              text: "💰 **Crypto Balance**\n\nNo cryptocurrency accounts found or all balances are zero."
            }]
          };
        }

        // Save crypto addresses for future use (for payments)
        tokenStore.saveCryptoAddresses(balances);

        // Format balance information
        let output = `💰 **Cryptocurrency Balance**\n\n`;
        output += `Found ${balances.length} account(s):\n\n`;
        
        let totalUsdValue = 0;
        const coinPrices: { [key: string]: number } = {
          "btc": 65000,  // Approximate prices for display purposes
          "eth": 3500,   // In production, these should come from a price API
          "usdt": 1,
          "usdc": 1
        };
        
        balances.forEach((account: any, index: number) => {
          const coin = (account.coin || 'Unknown').toLowerCase();
          const balance = account.balance || 0;
          const address = account.address || 'N/A';
          
          // Show full address for payment purposes
          output += `**${index + 1}. ${coin.toUpperCase()}**\n`;
          output += `├─ Balance: ${balance} ${coin.toUpperCase()}\n`;
          output += `├─ Address: \`${address}\`\n`;
          
          // Calculate USD value if price is known
          const price = coinPrices[coin.toLowerCase()];
          if (price && balance > 0) {
            const usdValue = balance * price;
            totalUsdValue += usdValue;
            output += `├─ Value: $${usdValue.toFixed(2)} USD\n`;
          }
          
          if (index < balances.length - 1) {
            output += `\n`;
          }
        });
        
        if (totalUsdValue > 0) {
          output += `\n${"-".repeat(50)}\n`;
          output += `**Total Value: $${totalUsdValue.toFixed(2)} USD**\n\n`;
        }
        
        output += `\n📝 **Payment Instructions:**\n`;
        output += `To add balance to your Coronium account, send cryptocurrency to the addresses above.\n`;
        output += `Addresses have been saved locally for future reference.`;

        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      } catch (error) {
        logger.error("Failed to fetch crypto balance:", error);
        return {
          content: [{
            type: "text",
            text: `❌ Failed to fetch crypto balance: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );

  /**
   * Tool: coronium_get_credit_cards
   * Fetches and displays saved credit cards
   */
  server.tool(
    "coronium_get_credit_cards",
    "💳 Displays saved payment methods (masked card numbers). REQUIRES AUTHENTICATION: If this fails, run coronium_get_token first. Card IDs can be used for automated purchases.",
    async (args: any) => {
      // Validate input
      const parsed = GetCreditCardsArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{
            type: "text",
            text: `Invalid input: ${parsed.error.errors.map(e => e.message).join(", ")}`
          }]
        };
      }

      // Get token (prefer args over stored)
      const token = parsed.data.token || tokenStore.get();
      if (!token) {
        return {
          content: [{
            type: "text",
            text: "❌ No token available. Please authenticate first using coronium_get_token."
          }]
        };
      }

      try {
        // Fetch credit cards from API
        const cards = await api.getCreditCards(token);
        
        logger.debug(`Credit cards response:`, cards);
        
        if (!cards || cards.length === 0) {
          return {
            content: [{
              type: "text",
              text: "💳 **Saved Credit Cards**\n\nNo credit cards found. Please add a card through the Coronium website to enable proxy purchases."
            }]
          };
        }

        // Format card information
        let output = `💳 **Saved Credit Cards**\n\n`;
        output += `Found ${cards.length} saved card(s):\n\n`;
        
        cards.forEach((card: any, index: number) => {
          const brand = (card.brand || 'Unknown').toUpperCase();
          const last4 = card.last4 || 'XXXX';
          const expMonth = card.exp_month || 'XX';
          const expYear = card.exp_year || 'XXXX';
          const isDefault = card.is_default || false;
          const cardId = card._id || 'N/A';
          const country = card.country || 'N/A';
          const funding = card.funding || 'N/A';
          
          output += `**Card ${index + 1}:**\n`;
          output += `├─ Brand: ${brand}\n`;
          output += `├─ Last 4: ****${last4}\n`;
          output += `├─ Expiry: ${expMonth}/${expYear}\n`;
          output += `├─ Country: ${country}\n`;
          output += `├─ Type: ${funding}\n`;
          output += `├─ Card ID: \`${cardId}\`\n`;
          
          if (isDefault) {
            output += `├─ ⭐ Default Payment Method\n`;
          }
          
          if (index < cards.length - 1) {
            output += `\n`;
          }
        });
        
        output += `\n📝 **Usage:**\n`;
        output += `These cards can be used to purchase new proxies through the Coronium platform.\n`;
        output += `Card IDs are saved for automated proxy purchasing workflows.`;

        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      } catch (error) {
        logger.error("Failed to fetch credit cards:", error);
        return {
          content: [{
            type: "text",
            text: `❌ Failed to fetch credit cards: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );

  // ===========================================
  // Start Server
  // ===========================================
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  logger.info("Server started successfully");
  logger.info(`API endpoint: ${config.baseUrl}`);
  
  // Check initial state
  if (tokenStore.get()) {
    logger.info("Existing token found in storage");
    // Don't validate on startup - let the user decide
  } else if (config.login && config.password) {
    logger.info("Credentials configured - ready to authenticate");
  } else {
    logger.warn("No credentials configured - set CORONIUM_LOGIN and CORONIUM_PASSWORD");
  }
}

// ===========================================
// Error Handler & Startup
// ===========================================

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start the server
main().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});