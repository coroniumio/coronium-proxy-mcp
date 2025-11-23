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
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
    const configDir = path.join(os.homedir(), ".coronium");
    this.tokenPath = path.join(configDir, "token.enc");
    this.cryptoAddressesPath = path.join(configDir, "crypto_addresses.json");
    this.encryptionKey = config.tokenEncryptionKey;
    
    // Create config directory if needed
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
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
      const configDir = path.join(os.homedir(), ".coronium");
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.cryptoAddressesPath, JSON.stringify(addresses, null, 2));
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
      if (fs.existsSync(this.cryptoAddressesPath)) {
        const data = fs.readFileSync(this.cryptoAddressesPath, "utf8");
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
    if (fs.existsSync(this.tokenPath)) {
      try {
        fs.writeFileSync(this.tokenPath, "");
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
        fs.writeFileSync(this.tokenPath, encrypted, "utf8");
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
    if (fs.existsSync(this.tokenPath)) {
      try {
        const encrypted = fs.readFileSync(this.tokenPath, "utf8");
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
// Rotation Manager
// ===========================================

/**
 * Manages proxy IP rotation operations
 */
class RotationManager {
  private client: AxiosInstance;
  private logger: Logger;
  private maxRetries: number = 3;
  private retryDelay: number = 5000;

  constructor(logger: Logger) {
    this.logger = logger;
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'Coronium-MCP-Server/1.0'
      }
    });
  }

  /**
   * Rotates a proxy's IP address with improved verification
   */
  async rotateProxy(proxy: any, apiClient?: CoroniumAPI, authToken?: string): Promise<RotationResult> {
    const startTime = Date.now();
    const oldIp = proxy.ext_ip || 'unknown';

    try {
      // Check for rotation token
      if (!proxy.restartByToken && !proxy.restartToken) {
        throw new Error('No rotation token available for this proxy');
      }

      this.logger.info(`Rotating proxy ${proxy.name} (Current IP: ${oldIp})...`);

      // Use the full URL if available, otherwise construct it
      const rotationUrl = proxy.restartByToken ||
        `https://mreset.xyz/restart-modem/${proxy.restartToken}`;

      // Initiate rotation
      const response = await this.client.get(rotationUrl);
      this.logger.debug(`Rotation initiated for ${proxy.name}`);

      // Initial wait for modem to restart
      this.logger.debug(`Waiting for modem to restart...`);
      await this.wait(10000); // Initial 10 second wait

      // Check new status with retries
      let newIp = 'pending';
      let verificationAttempts = 0;
      const maxVerificationAttempts = 5;

      if (proxy.statusByToken || proxy.restartToken) {
        const statusUrl = proxy.statusByToken ||
          `https://mreset.xyz/get-modem-status/${proxy.restartToken}`;

        this.logger.debug(`Starting IP verification with up to ${maxVerificationAttempts} attempts...`);

        while (verificationAttempts < maxVerificationAttempts && newIp === 'pending') {
          verificationAttempts++;
          this.logger.debug(`Verification attempt ${verificationAttempts}/${maxVerificationAttempts}...`);

          try {
            const status = await this.checkStatus(statusUrl);

            if (status.currentIp && status.currentIp !== 'unknown') {
              // Check if IP has actually changed
              if (status.currentIp !== oldIp) {
                newIp = status.currentIp;
                this.logger.info(`✅ New IP confirmed: ${newIp} (was ${oldIp})`);
                break;
              } else {
                this.logger.debug(`IP not changed yet, still ${status.currentIp}`);
                // Continue waiting if we haven't exhausted attempts
                if (verificationAttempts < maxVerificationAttempts) {
                  await this.wait(4000); // Wait 4 more seconds before next check
                }
              }
            } else {
              this.logger.debug(`Status check returned unknown IP`);
              if (verificationAttempts < maxVerificationAttempts) {
                await this.wait(3000); // Wait 3 seconds before retry
              }
            }
          } catch (statusError: any) {
            this.logger.warn(`Status check attempt ${verificationAttempts} failed: ${statusError.message}`);
            if (verificationAttempts < maxVerificationAttempts) {
              await this.wait(3000);
            }
          }
        }
      }

      // If direct status check didn't work or returned same IP, try fallback via Coronium API
      if ((newIp === 'pending' || newIp === oldIp) && apiClient && authToken) {
        this.logger.info(`Attempting fallback IP verification via Coronium API...`);
        try {
          // Wait a bit more for the change to propagate
          await this.wait(5000);

          const updatedProxies = await apiClient.getProxies(authToken);
          const updatedProxy = updatedProxies.find((p: any) => p._id === proxy._id);

          if (updatedProxy && updatedProxy.ext_ip) {
            if (updatedProxy.ext_ip !== oldIp) {
              newIp = updatedProxy.ext_ip;
              this.logger.info(`✅ New IP verified via API: ${newIp}`);
            } else {
              this.logger.warn(`API still shows old IP: ${updatedProxy.ext_ip}`);
              // One more wait and check
              await this.wait(5000);
              const finalCheck = await apiClient.getProxies(authToken);
              const finalProxy = finalCheck.find((p: any) => p._id === proxy._id);
              if (finalProxy && finalProxy.ext_ip !== oldIp) {
                newIp = finalProxy.ext_ip;
                this.logger.info(`✅ Final check - New IP confirmed: ${newIp}`);
              }
            }
          }
        } catch (apiError: any) {
          this.logger.warn(`API fallback verification failed: ${apiError.message}`);
        }
      }

      // Determine if rotation was successful
      const rotationSuccess = newIp !== 'pending' && newIp !== 'unknown' && newIp !== oldIp;

      return {
        success: rotationSuccess,
        proxyId: proxy._id,
        proxyName: proxy.name,
        oldIp: oldIp,
        newIp: newIp === 'pending' ? 'verification timeout' : newIp,
        rotationTime: Date.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error: any) {
      this.logger.error(`Rotation failed for ${proxy.name}:`, error);
      return {
        success: false,
        proxyId: proxy._id,
        proxyName: proxy.name,
        oldIp: oldIp,
        rotationTime: Date.now() - startTime,
        timestamp: Date.now(),
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Checks the status of a proxy
   */
  async checkStatus(statusUrl: string): Promise<ProxyStatus> {
    try {
      const response = await this.client.get(statusUrl);

      // Handle nested data structure (mreset.xyz returns data in data.data)
      const data = response.data.data || response.data;

      // Extract IP from various possible field names
      let currentIp = 'unknown';
      if (data.ext_ip) {
        currentIp = data.ext_ip;
      } else if (data.external_ip) {
        currentIp = data.external_ip;
      } else if (data.current_ip) {
        currentIp = data.current_ip;
      } else if (data.ip) {
        currentIp = data.ip;
      }

      return {
        online: data.status === 'active' || response.data.online !== false,
        currentIp: currentIp,
        uptime: data.uptime,
        lastRotation: data.rotated_at || data.last_rotation
      };
    } catch (error: any) {
      this.logger.warn('Status check failed:', error.message);
      return {
        online: false,
        currentIp: 'unknown'
      };
    }
  }

  /**
   * Helper function to wait
   */
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry with exponential backoff
   */
  async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries: number = this.maxRetries
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (i < retries - 1) {
          const delay = this.retryDelay * Math.pow(2, i);
          this.logger.debug(`Retry ${i + 1}/${retries} after ${delay}ms`);
          await this.wait(delay);
        }
      }
    }

    throw lastError!;
  }
}

// ===========================================
// Rotation History Manager
// ===========================================

/**
 * Manages rotation history tracking
 */
class RotationHistory {
  private historyDir: string;
  private historyFile: string;
  private logger: Logger;
  private maxEntries: number = 100;

  constructor(logger: Logger) {
    this.logger = logger;
    this.historyDir = path.join(os.homedir(), '.coronium');
    this.historyFile = path.join(this.historyDir, 'rotation_history.json');
    this.ensureHistoryFile();
  }

  /**
   * Ensures history file exists
   */
  private ensureHistoryFile(): void {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.historyDir)) {
        fs.mkdirSync(this.historyDir, { recursive: true });
      }

      // Create file if it doesn't exist
      if (!fs.existsSync(this.historyFile)) {
        fs.writeFileSync(this.historyFile, '[]', 'utf8');
      }
    } catch (error) {
      this.logger.warn('Could not create history file:', error);
    }
  }

  /**
   * Adds a rotation entry to history
   */
  async addRotation(entry: RotationEntry): Promise<void> {
    try {
      const history = this.getHistory();
      history.push(entry);

      // Keep only last N entries
      const pruned = history.slice(-this.maxEntries);

      fs.writeFileSync(this.historyFile, JSON.stringify(pruned, null, 2));
      this.logger.debug(`Added rotation history for ${entry.proxyName}`);
    } catch (error) {
      this.logger.warn('Failed to save rotation history:', error);
    }
  }

  /**
   * Gets rotation history
   */
  getHistory(proxyId?: string): RotationEntry[] {
    try {
      const data = fs.readFileSync(this.historyFile, 'utf8');
      const history = JSON.parse(data);

      if (proxyId) {
        return history.filter((e: RotationEntry) => e.proxyId === proxyId);
      }

      return history;
    } catch {
      return [];
    }
  }

  /**
   * Gets the last rotation for a specific proxy
   */
  getLastRotation(proxyId: string): RotationEntry | null {
    const proxyHistory = this.getHistory(proxyId);
    return proxyHistory.length > 0 ? proxyHistory[proxyHistory.length - 1] : null;
  }
}

// ===========================================
// Type Definitions for Rotation
// ===========================================

interface RotationResult {
  success: boolean;
  proxyId: string;
  proxyName: string;
  oldIp: string;
  newIp?: string;
  rotationTime: number;
  timestamp: number;
  error?: string;
  statusUrl?: string;
}

interface ProxyStatus {
  online: boolean;
  currentIp: string;
  uptime?: number;
  lastRotation?: string;
  carrier?: string;
  signal?: number;
}

interface RotationEntry {
  id: string;
  proxyId: string;
  proxyName: string;
  oldIp: string;
  newIp: string;
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
}

// ===========================================
// Helper Functions
// ===========================================

/**
 * Filters proxies by status (online/offline)
 */
function filterByStatus(proxies: any[], status: 'online' | 'offline'): any[] {
  return proxies.filter(p => {
    if (status === 'online') {
      return p.isOnline === true || p.status === 'active';
    } else {
      return p.isOnline === false || p.status === 'inactive' || p.status === 'offline';
    }
  });
}

/**
 * Filters proxies by last rotation age
 * @param proxies Array of proxies
 * @param hours Minimum hours since last rotation
 */
function filterByRotationAge(proxies: any[], hours: number): any[] {
  const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
  return proxies.filter(p => {
    if (!p.rotated_at) return true; // Never rotated, include it
    const rotatedTime = new Date(p.rotated_at).getTime();
    return rotatedTime < cutoffTime;
  });
}

/**
 * Applies filter string to proxy list
 * Supports: 'online', 'offline', 'older-than-Xh'
 */
function applyFilter(proxies: any[], filter: string): any[] {
  if (!filter) return proxies;

  const lowerFilter = filter.toLowerCase().trim();

  // Check for online/offline
  if (lowerFilter === 'online') {
    return filterByStatus(proxies, 'online');
  }
  if (lowerFilter === 'offline') {
    return filterByStatus(proxies, 'offline');
  }

  // Check for age filter: older-than-Xh or older-than-Xd
  const ageMatch = lowerFilter.match(/older[_-]than[_-](\d+)([hd])/);
  if (ageMatch) {
    const value = parseInt(ageMatch[1]);
    const unit = ageMatch[2];
    const hours = unit === 'd' ? value * 24 : value;
    return filterByRotationAge(proxies, hours);
  }

  return proxies;
}

/**
 * Sorts proxies by priority:
 * 1. Online first
 * 2. Oldest rotation first
 * 3. Alphabetically by name
 */
function sortProxiesByPriority(proxies: any[]): any[] {
  return [...proxies].sort((a, b) => {
    // Online status (online first)
    const aOnline = a.isOnline === true ? 1 : 0;
    const bOnline = b.isOnline === true ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;

    // Rotation age (older first)
    const aTime = a.rotated_at ? new Date(a.rotated_at).getTime() : 0;
    const bTime = b.rotated_at ? new Date(b.rotated_at).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;

    // Alphabetically
    return (a.name || '').localeCompare(b.name || '');
  });
}

/**
 * Formats proxy information for display
 */
function formatProxyInfo(proxy: any, index?: number): string {
  const status = proxy.isOnline ? '🟢 Online' : '🔴 Offline';
  const ip = proxy.ext_ip || 'Unknown';

  let rotationInfo = 'Never rotated';
  if (proxy.rotated_at) {
    const rotatedDate = new Date(proxy.rotated_at);
    const hoursAgo = Math.floor((Date.now() - rotatedDate.getTime()) / (1000 * 60 * 60));
    if (hoursAgo < 1) {
      rotationInfo = 'Rotated <1h ago';
    } else if (hoursAgo < 24) {
      rotationInfo = `Rotated ${hoursAgo}h ago`;
    } else {
      const daysAgo = Math.floor(hoursAgo / 24);
      rotationInfo = `Rotated ${daysAgo}d ago`;
    }
  }

  const parts = proxy.name?.split('_') || [];
  const country = parts[1]?.toUpperCase() || 'XX';
  const number = parts[0]?.replace(/\D/g, '') || '???';

  let output = index !== undefined ? `${index}. ` : '';
  output += `**${proxy.name}**\n`;
  output += `   └─ ${status} | ${ip} | ${rotationInfo}\n`;
  output += `   └─ Country: ${country} | Number: ${number}`;

  return output;
}

/**
 * Creates interactive proxy selection message
 */
function createProxySelectionMessage(proxies: any[], identifier: string): string {
  let message = `🔍 Found **${proxies.length}** proxies matching "${identifier}":\n\n`;

  proxies.forEach((p, i) => {
    message += formatProxyInfo(p, i + 1) + '\n\n';
  });

  message += `\n**How to select a specific proxy:**\n`;
  message += `• Use full name: \`"${proxies[0]?.name}"\`\n`;

  const parts = proxies[0]?.name?.split('_') || [];
  if (parts[0]) {
    const number = parts[0].replace(/\D/g, '');
    if (number) {
      message += `• Use dongle number: \`"${number}"\`\n`;
    }
  }

  if (parts[1]) {
    message += `• Use country code: \`"${parts[1]}"\`\n`;
  }

  // Group by country
  const byCountry: { [key: string]: any[] } = {};
  proxies.forEach(p => {
    const country = p.name?.split('_')[1] || 'Unknown';
    if (!byCountry[country]) byCountry[country] = [];
    byCountry[country].push(p);
  });

  if (Object.keys(byCountry).length > 1) {
    message += `\n**Filter by country:**\n`;
    Object.keys(byCountry).forEach(country => {
      message += `• \`"${country}"\` - ${byCountry[country].length} proxy/proxies\n`;
    });
  }

  message += `\n**Filter options:**\n`;
  message += `• \`"online"\` - Only online proxies\n`;
  message += `• \`"offline"\` - Only offline proxies\n`;
  message += `• \`"older-than-2h"\` - Rotated >2 hours ago\n`;
  message += `• \`"all"\` - Rotate all listed proxies\n`;

  return message;
}

/**
 * Finds proxies by identifier (name, ID, dongle ID, or country)
 * Prioritizes exact matches over partial matches
 */
function findProxyByIdentifier(proxies: any[], identifier: string): any[] {
  if (!identifier) return [];

  const lowerIdentifier = identifier.toLowerCase();

  // 1. First, check by exact proxy name match (case-insensitive)
  const exactNameMatch = proxies.filter(p =>
    p.name?.toLowerCase() === lowerIdentifier
  );
  if (exactNameMatch.length > 0) return exactNameMatch;

  // 2. Check by exact proxy ID (_id field)
  const idMatch = proxies.filter(p => p._id === identifier);
  if (idMatch.length > 0) return idMatch;

  // 3. Check by dongle ID (the part after country, e.g., "5f6e24c946e34469127e586aac6cee46")
  const dongleMatch = proxies.filter(p => {
    const nameParts = p.name?.split('_') || [];
    const dongleId = nameParts[2]; // cor_COUNTRY_DONGLEID
    return dongleId && (dongleId.toLowerCase() === lowerIdentifier ||
           dongleId.toLowerCase().startsWith(lowerIdentifier));
  });
  if (dongleMatch.length === 1) return dongleMatch; // Return only if unique match

  // 4. Check if it's a country code (e.g., US, UA)
  const countryProxies = proxies.filter(p => {
    const nameParts = p.name?.split('_') || [];
    // Important: Don't convert to lowercase here to preserve exact country code matching
    // Country codes should match case-insensitively but exactly (US != UA)
    return nameParts[1]?.toLowerCase() === lowerIdentifier; // Check second part for exact country match
  });

  // If only one proxy for this country, return it
  if (countryProxies.length === 1) return countryProxies;

  // If multiple proxies for this country, return empty to force user to be more specific
  if (countryProxies.length > 1) {
    // We'll handle this in the calling code to provide better error message
    return countryProxies;
  }

  // 5. Partial match on full name (last resort)
  const partialMatch = proxies.filter(p =>
    p.name?.toLowerCase().includes(lowerIdentifier)
  );

  // Only return partial matches if there's a single unique match
  if (partialMatch.length === 1) return partialMatch;

  // Return all partial matches to let calling code handle disambiguation
  return partialMatch;
}

/**
 * Rotates multiple proxies with concurrency control
 */
async function rotateMultipleProxies(
  proxies: any[],
  rotationManager: RotationManager,
  logger: Logger,
  apiClient?: CoroniumAPI,
  authToken?: string
): Promise<RotationResult[]> {
  const concurrencyLimit = 3;
  const results: RotationResult[] = [];

  logger.info(`Rotating ${proxies.length} proxies with concurrency limit of ${concurrencyLimit}`);

  for (let i = 0; i < proxies.length; i += concurrencyLimit) {
    const batch = proxies.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map(proxy => rotationManager.rotateProxy(proxy, apiClient, authToken))
    );
    results.push(...batchResults);
  }

  return results;
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

const RotateModemArgsSchema = z.object({
  proxy_identifier: z.string().optional().describe("Name, ID, country code, or filter (e.g., 'de', 'dongle540', 'online', 'offline', 'older-than-2h')"),
  all: z.boolean().optional().describe("Rotate all proxies"),
  filter: z.string().optional().describe("Additional filter: 'online', 'offline', 'older-than-Xh' where X is hours"),
  wait_for_completion: z.boolean().optional().default(true).describe("Wait for rotation to complete"),
  max_wait_time: z.number().optional().default(30000).describe("Maximum time to wait in milliseconds"),
  auto_select: z.boolean().optional().default(true).describe("Automatically select if only one match found")
});

// ===========================================
// MCP Server Setup
// ===========================================

/**
 * Main server initialization and tool registration
 */
async function main() {
  logger.info("Starting Coronium MCP Server v1.0.0");
  logger.debug("Config - Base URL:", config.baseUrl);
  logger.debug("Config - Login:", config.login || "NOT SET");
  logger.debug("Config - Password:", config.password ? "SET (length: " + config.password.length + ")" : "NOT SET");
  logger.debug("Config - Log Level:", config.logLevel);

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

      logger.debug("Login attempt - Email:", login);
      logger.debug("Login attempt - Password length:", password?.length || 0);
      logger.debug("Config values - Login:", config.login);
      logger.debug("Config values - Password set:", config.password ? "Yes" : "No");

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

          // Add rotation URLs with tokens
          if (proxy.restartToken) {
            output += `├─ Rotation Token: ${proxy.restartToken}\n`;
          }

          output += `\n`;

          // Add connection strings for easy copying
          output += `**Connection Strings:**\n`;
          output += `HTTP: http://${username}:${password}@${connectionIP}:${httpPort}\n`;
          output += `SOCKS5: socks5://${username}:${password}@${connectionIP}:${socks5Port}\n`;

          // Add mreset.xyz URLs if available
          if (proxy.restartByToken || proxy.statusByToken) {
            output += `\n**Rotation URLs:**\n`;
            if (proxy.restartByToken) {
              output += `Restart: ${proxy.restartByToken}\n`;
            }
            if (proxy.statusByToken) {
              output += `Status: ${proxy.statusByToken}\n`;
            }
          }
          
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

  /**
   * Tool: coronium_rotate_modem
   * Rotates the IP address of mobile proxies
   */
  server.tool(
    "coronium_rotate_modem",
    "🔄 Rotates the IP address of your mobile proxy. Can rotate by name, country (e.g., 'US'), or rotate all proxies. Requires authentication. Examples: 'rotate US', 'rotate all', 'rotate cor_US_xxx'",
    {
      proxy_identifier: z.string().optional().describe("Name, ID, country code, or filter (e.g., 'de', 'dongle540', 'online', 'offline', 'older-than-2h')"),
      all: z.boolean().optional().describe("Rotate all proxies"),
      filter: z.string().optional().describe("Additional filter: 'online', 'offline', 'older-than-Xh' where X is hours"),
      wait_for_completion: z.boolean().optional().default(true).describe("Wait for rotation to complete"),
      max_wait_time: z.number().optional().default(30000).describe("Maximum time to wait in milliseconds"),
      auto_select: z.boolean().optional().default(true).describe("Automatically select if only one match found")
    },
    async (args: any) => {
      const parsed = RotateModemArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{
            type: "text",
            text: `❌ Invalid input: ${parsed.error.errors.map(e => e.message).join(", ")}`
          }]
        };
      }

      // Check authentication
      const token = tokenStore.get();
      if (!token) {
        return {
          content: [{
            type: "text",
            text: "❌ No authentication token found. Please run coronium_get_token first to authenticate."
          }]
        };
      }

      try {
        // Get current proxies
        logger.info("Fetching proxies for rotation...");
        const proxies = await api.getProxies(token);

        if (!proxies || proxies.length === 0) {
          return {
            content: [{
              type: "text",
              text: "❌ No proxies found in your account."
            }]
          };
        }

        // Initialize managers
        const rotationManager = new RotationManager(logger);
        const history = new RotationHistory(logger);

        // Determine which proxies to rotate
        let targetProxies: any[] = [];
        let appliedFilters: string[] = [];

        // Step 1: Get initial proxy set
        if (parsed.data.all) {
          logger.info("Rotating all proxies");
          targetProxies = [...proxies];
          appliedFilters.push('all proxies');
        } else if (parsed.data.proxy_identifier) {
          const identifier = parsed.data.proxy_identifier.trim();
          logger.info(`Finding proxy by identifier: ${identifier}`);

          // Check if identifier is a filter command
          if (identifier === 'online' || identifier === 'offline' || identifier.match(/older[_-]than/)) {
            targetProxies = applyFilter(proxies, identifier);
            appliedFilters.push(identifier);
          } else {
            targetProxies = findProxyByIdentifier(proxies, identifier);
            if (targetProxies.length > 0) {
              appliedFilters.push(`identifier: ${identifier}`);
            }
          }
        } else {
          // No identifier - show available proxies and ask user to select
          logger.info("No identifier provided - showing proxy list");
          const sortedProxies = sortProxiesByPriority(proxies);

          let message = `📋 **Your Proxies** (${proxies.length} total):\n\n`;
          sortedProxies.forEach((p, i) => {
            message += formatProxyInfo(p, i + 1) + '\n\n';
          });

          message += `\n**To rotate a proxy, specify:**\n`;
          message += `• Country code: \`"de"\`, \`"us"\`, \`"ua"\`\n`;
          message += `• Dongle number: \`"540"\`, \`"713"\`\n`;
          message += `• Full name: \`"${sortedProxies[0]?.name}"\`\n`;
          message += `• Filter: \`"online"\`, \`"offline"\`, \`"older-than-2h"\`\n`;
          message += `• All proxies: \`"all"\`\n`;

          return {
            content: [{
              type: "text",
              text: message
            }]
          };
        }

        // Step 2: Apply additional filter if provided
        if (parsed.data.filter) {
          const beforeCount = targetProxies.length;
          targetProxies = applyFilter(targetProxies, parsed.data.filter);
          appliedFilters.push(parsed.data.filter);
          logger.info(`Applied filter "${parsed.data.filter}": ${beforeCount} → ${targetProxies.length} proxies`);
        }

        // Step 3: Handle results
        if (targetProxies.length === 0) {
          const filterDesc = appliedFilters.length > 0 ? ` matching filters: ${appliedFilters.join(', ')}` : '';

          let message = `❌ No proxies found${filterDesc}\n\n`;
          message += `**Available proxies:**\n\n`;
          proxies.forEach((p: any, i: number) => {
            message += formatProxyInfo(p, i + 1) + '\n\n';
          });

          message += `\n**Try:**\n`;
          message += `• Different identifier or filter\n`;
          message += `• \`"all"\` to rotate all proxies\n`;
          message += `• \`"online"\` to rotate only online proxies\n`;

          return {
            content: [{
              type: "text",
              text: message
            }]
          };
        }

        // Step 4: Handle multiple matches
        if (targetProxies.length > 1 && !parsed.data.all) {
          const filterDesc = appliedFilters.length > 0 ? ` (${appliedFilters.join(', ')})` : '';

          // If only one online proxy and auto_select is enabled, auto-select it
          const onlineProxies = filterByStatus(targetProxies, 'online');
          const autoSelect = parsed.data.auto_select !== false; // Default true
          if (onlineProxies.length === 1 && autoSelect) {
            logger.info(`Auto-selecting single online proxy: ${onlineProxies[0].name}`);
            targetProxies = onlineProxies;
          } else {
            // Show interactive selection
            let message = `🔍 Found **${targetProxies.length}** proxies${filterDesc}:\n\n`;

            const sortedMatches = sortProxiesByPriority(targetProxies);
            sortedMatches.forEach((p, i) => {
              message += formatProxyInfo(p, i + 1) + '\n\n';
            });

            message += `\n**Next steps:**\n`;
            message += `• To rotate **one**, be more specific with the identifier\n`;
            message += `• To rotate **all ${targetProxies.length}**, use parameter \`all: true\`\n`;
            message += `• To rotate only **online** (${onlineProxies.length}), add filter: \`"online"\`\n\n`;

            message += `**Selection examples:**\n`;
            if (sortedMatches[0]) {
              const parts = sortedMatches[0].name?.split('_') || [];
              message += `• Full name: \`"${sortedMatches[0].name}"\`\n`;
              if (parts[0]) {
                const num = parts[0].replace(/\D/g, '');
                if (num) message += `• By number: \`"${num}"\`\n`;
              }
            }

            return {
              content: [{
                type: "text",
                text: message
              }]
            };
          }
        }

        // Step 5: Confirm batch rotation if rotating multiple
        if (targetProxies.length > 3) {
          const onlineCount = filterByStatus(targetProxies, 'online').length;
          const offlineCount = targetProxies.length - onlineCount;
          const estimatedTime = Math.ceil(targetProxies.length * 10 / 60);

          let confirmMessage = `⚠️  **Batch Rotation Confirmation**\n\n`;
          confirmMessage += `You're about to rotate **${targetProxies.length} proxies**:\n`;
          confirmMessage += `├─ 🟢 Online: ${onlineCount}\n`;
          confirmMessage += `└─ 🔴 Offline: ${offlineCount}\n\n`;
          confirmMessage += `**Estimated time:** ~${estimatedTime} minute${estimatedTime > 1 ? 's' : ''}\n\n`;

          // For now, proceed automatically. In future, could add confirmation parameter
          logger.info(`Batch rotation: ${targetProxies.length} proxies, estimated ${estimatedTime}min`);
        }

        // Show what we're rotating
        let statusMessage = "";
        if (targetProxies.length === 1) {
          statusMessage = `🔄 **Rotating proxy: ${targetProxies[0].name}**\n\n`;
          statusMessage += `Current IP: ${targetProxies[0].ext_ip || 'unknown'}\n`;
          statusMessage += `Please wait while the modem restarts...\n`;
        } else {
          statusMessage = `🔄 **Rotating ${targetProxies.length} proxies**\n\n`;
          targetProxies.forEach((p: any) => {
            statusMessage += `• ${p.name} (${p.ext_ip || 'unknown'})\n`;
          });
          statusMessage += `\nThis may take up to ${targetProxies.length * 10} seconds...\n`;
        }

        logger.info(`Rotating ${targetProxies.length} proxy/proxies`);

        // Perform rotation with API fallback
        let results: RotationResult[];

        if (targetProxies.length === 1) {
          const result = await rotationManager.rotateProxy(targetProxies[0], api, token);
          results = [result];
        } else {
          results = await rotateMultipleProxies(targetProxies, rotationManager, logger, api, token);
        }

        // Save to history
        for (const result of results) {
          if (result.success) {
            await history.addRotation({
              id: crypto.randomBytes(16).toString('hex'),
              proxyId: result.proxyId,
              proxyName: result.proxyName,
              oldIp: result.oldIp,
              newIp: result.newIp || 'unknown',
              timestamp: result.timestamp,
              duration: result.rotationTime,
              success: result.success
            });
          }
        }

        // Format response
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        let responseText = "";

        if (results.length === 1) {
          const result = results[0];
          if (result.success) {
            responseText = `✅ **Successfully rotated ${result.proxyName}**\n\n`;
            responseText += `├─ Old IP: ${result.oldIp}\n`;
            responseText += `├─ New IP: ${result.newIp}\n`;
            responseText += `└─ Rotation time: ${(result.rotationTime / 1000).toFixed(1)}s\n\n`;

            // Try to get updated proxy info
            if (parsed.data.wait_for_completion && result.newIp !== 'verification failed') {
              try {
                const updatedProxies = await api.getProxies(token);
                const updatedProxy = updatedProxies.find((p: any) => p._id === result.proxyId);
                if (updatedProxy && updatedProxy.ext_ip !== result.oldIp) {
                  responseText += `🌐 **Verified new external IP: ${updatedProxy.ext_ip}**\n`;
                }
              } catch {
                // Ignore verification errors
              }
            }

            responseText += `\n💡 **Tip:** Your proxy is now using the new IP address. All connections through this proxy will use the new IP.`;
          } else {
            responseText = `❌ **Failed to rotate ${result.proxyName}**\n\n`;
            responseText += `└─ Error: ${result.error}\n\n`;
            responseText += `Please try again in a few moments or check the proxy status.`;
          }
        } else {
          responseText = `🔄 **Rotation Results**\n\n`;
          responseText += `Rotated ${results.length} proxies:\n`;
          responseText += `├─ ✅ Successful: ${successCount}\n`;
          responseText += `└─ ❌ Failed: ${failCount}\n\n`;

          responseText += `**Details:**\n`;
          for (const result of results) {
            if (result.success) {
              responseText += `✅ ${result.proxyName}:\n`;
              responseText += `   ${result.oldIp} → ${result.newIp} (${(result.rotationTime / 1000).toFixed(1)}s)\n`;
            } else {
              responseText += `❌ ${result.proxyName}: ${result.error}\n`;
            }
          }

          if (successCount > 0) {
            responseText += `\n✨ Successfully rotated ${successCount} proxy IP${successCount > 1 ? 's' : ''}.`;
          }
        }

        return {
          content: [{
            type: "text",
            text: responseText
          }]
        };

      } catch (error: any) {
        logger.error("Rotation error:", error);
        return {
          content: [{
            type: "text",
            text: `❌ Rotation failed: ${error.message || 'Unknown error'}\n\nPlease check your connection and try again.`
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