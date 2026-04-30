// Live coin price fetcher for crypto balance display.
//
// Hits CoinGecko's free, unauthenticated /simple/price endpoint and caches
// the result for 60 seconds in process memory. If the call fails (rate
// limit, network blip), we fall back to the previously cached value if
// any, or to conservative static defaults so the rest of the tool still
// renders something useful.

import axios from "axios";
import {config} from "./config.js";
import {logger} from "./logger.js";

const FALLBACK_PRICES: Record<string, number> = {
    btc: 95_000,
    eth: 3_500,
    usdt: 1,
    usdc: 1,
    trx: 0.25,
    sol: 200,
};

const COINGECKO_IDS: Record<string, string> = {
    btc: "bitcoin",
    eth: "ethereum",
    usdt: "tether",
    usdc: "usd-coin",
    trx: "tron",
    sol: "solana",
};

let cache: {prices: Record<string, number>, fetchedAt: number} | null = null;
const CACHE_TTL_MS = 60_000;

export async function getCoinPrices(coins: string[] = Object.keys(COINGECKO_IDS)): Promise<Record<string, number>> {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.prices;
    }

    const ids = coins.map(c => COINGECKO_IDS[c.toLowerCase()]).filter(Boolean);
    if (ids.length === 0) return {...FALLBACK_PRICES};

    try {
        const r = await axios.get(config.pricesUrl, {
            params: {ids: ids.join(","), vs_currencies: "usd"},
            timeout: 6000,
        });
        const prices: Record<string, number> = {};
        for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
            const v = r.data?.[id]?.usd;
            if (typeof v === "number") prices[sym] = v;
        }
        if (Object.keys(prices).length === 0) throw new Error("empty price response");
        cache = {prices, fetchedAt: now};
        return prices;
    } catch (e: any) {
        logger.warn(`Price fetch failed: ${e?.message}. Using ${cache ? "stale cache" : "static fallback"}.`);
        return cache?.prices || {...FALLBACK_PRICES};
    }
}
