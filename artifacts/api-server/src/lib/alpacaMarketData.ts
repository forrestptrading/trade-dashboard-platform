export type AlpacaFeed = "sip" | "iex" | "delayed_sip";

export interface AlpacaConfigCheck {
  success: true;
  keyIdConfigured: boolean;
  secretKeyConfigured: boolean;
  feed: AlpacaFeed;
}

export interface NormalizedAlpacaBar {
  symbol: string;
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  tradeCount: number | null;
  vwap: number | null;
  feed: AlpacaFeed;
  source: "alpaca";
  fallbackUsed?: "iex";
}

export class AlpacaMarketDataError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "AlpacaMarketDataError";
  }
}

const BASE_URL = "https://data.alpaca.markets";
const DEFAULT_FEED: AlpacaFeed = "iex";
const SUPPORTED_FEEDS = new Set<AlpacaFeed>(["sip", "iex", "delayed_sip"]);
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;
const REQUEST_TIMEOUT_MS = 8_000;

function readCredentials(): { keyId: string; secretKey: string } {
  return {
    keyId: process.env["ALPACA_API_KEY_ID"]?.trim() ?? "",
    secretKey: process.env["ALPACA_API_SECRET_KEY"]?.trim() ?? "",
  };
}

export function getConfiguredAlpacaFeed(): AlpacaFeed {
  const feed = process.env["ALPACA_MARKET_DATA_FEED"]?.trim().toLowerCase();
  return SUPPORTED_FEEDS.has(feed as AlpacaFeed) ? (feed as AlpacaFeed) : DEFAULT_FEED;
}

export function getAlpacaConfigCheck(): AlpacaConfigCheck {
  const credentials = readCredentials();
  return {
    success: true,
    keyIdConfigured: credentials.keyId.length > 0,
    secretKeyConfigured: credentials.secretKey.length > 0,
    feed: getConfiguredAlpacaFeed(),
  };
}

export function normalizeTickerSymbol(value: unknown): string {
  if (typeof value !== "string") {
    throw new AlpacaMarketDataError("A valid ticker symbol is required", 400);
  }
  const symbol = value.trim().toUpperCase();
  if (symbol.length < 1 || symbol.length > 12 || !SYMBOL_PATTERN.test(symbol)) {
    throw new AlpacaMarketDataError("A valid ticker symbol is required", 400);
  }
  return symbol;
}

function requireCredentials(): { keyId: string; secretKey: string } {
  const credentials = readCredentials();
  if (!credentials.keyId || !credentials.secretKey) {
    throw new AlpacaMarketDataError("Alpaca Market Data credentials are not configured", 503);
  }
  return credentials;
}

function normalizeBar(symbol: string, feed: AlpacaFeed, body: unknown): NormalizedAlpacaBar {
  const bar = (body as { bar?: Record<string, unknown> } | null)?.bar;
  if (!bar || typeof bar !== "object") {
    throw new AlpacaMarketDataError("Alpaca Market Data returned an unexpected response", 502);
  }
  return {
    symbol,
    timestamp: typeof bar.t === "string" ? bar.t : "",
    open: typeof bar.o === "number" ? bar.o : null,
    high: typeof bar.h === "number" ? bar.h : null,
    low: typeof bar.l === "number" ? bar.l : null,
    close: typeof bar.c === "number" ? bar.c : null,
    volume: typeof bar.v === "number" ? bar.v : null,
    tradeCount: typeof bar.n === "number" ? bar.n : null,
    vwap: typeof bar.vw === "number" ? bar.vw : null,
    feed,
    source: "alpaca",
  };
}

async function requestLatestBar(symbol: string, feed: AlpacaFeed): Promise<NormalizedAlpacaBar> {
  const credentials = requireCredentials();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(`/v2/stocks/${encodeURIComponent(symbol)}/bars/latest`, BASE_URL);
  url.searchParams.set("feed", feed);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": credentials.keyId,
        "APCA-API-SECRET-KEY": credentials.secretKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AlpacaMarketDataError("Alpaca Market Data request was not authorized", response.status, response.status);
      }
      throw new AlpacaMarketDataError("Alpaca Market Data request failed", 502, response.status);
    }

    return normalizeBar(symbol, feed, await response.json());
  } catch (error) {
    if (error instanceof AlpacaMarketDataError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AlpacaMarketDataError("Alpaca Market Data request timed out", 504);
    }
    throw new AlpacaMarketDataError("Alpaca Market Data request failed", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLatestAlpacaStockBar(symbolInput: unknown): Promise<NormalizedAlpacaBar> {
  const symbol = normalizeTickerSymbol(symbolInput);
  const feed = getConfiguredAlpacaFeed();

  try {
    return await requestLatestBar(symbol, feed);
  } catch (error) {
    if (error instanceof AlpacaMarketDataError && feed === "sip" && error.upstreamStatus === 403) {
      const fallback = await requestLatestBar(symbol, "iex");
      return { ...fallback, fallbackUsed: "iex" };
    }
    throw error;
  }
}
