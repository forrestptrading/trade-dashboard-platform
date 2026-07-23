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

export interface NormalizedAlpacaLiveQuote {
  symbol: string;
  price: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  tradeTimestamp: string | null;
  quoteTimestamp: string | null;
  timestamp: string | null;
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
const MAX_BATCH_SYMBOLS = 50;

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

export function normalizeTickerSymbols(value: unknown): string[] {
  if (typeof value !== "string") {
    throw new AlpacaMarketDataError("A valid comma-separated symbol list is required", 400);
  }
  const symbols = [...new Set(value.split(",").map((item) => normalizeTickerSymbol(item)))];
  if (!symbols.length || symbols.length > MAX_BATCH_SYMBOLS) {
    throw new AlpacaMarketDataError(`Between 1 and ${MAX_BATCH_SYMBOLS} symbols are required`, 400);
  }
  return symbols;
}

function requireCredentials(): { keyId: string; secretKey: string } {
  const credentials = readCredentials();
  if (!credentials.keyId || !credentials.secretKey) {
    throw new AlpacaMarketDataError("Alpaca Market Data credentials are not configured", 503);
  }
  return credentials;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : value;
}

function latestTimestamp(...values: Array<string | null>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.time));
  if (!valid.length) return null;
  valid.sort((a, b) => b.time - a.time);
  return valid[0]?.value ?? null;
}

async function requestJson(url: URL): Promise<unknown> {
  const credentials = requireCredentials();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      if (response.status === 429) {
        throw new AlpacaMarketDataError("Alpaca Market Data rate limit was reached", 429, 429);
      }
      throw new AlpacaMarketDataError("Alpaca Market Data request failed", 502, response.status);
    }
    return await response.json();
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

function normalizeBar(symbol: string, feed: AlpacaFeed, body: unknown): NormalizedAlpacaBar {
  const bar = (body as { bar?: Record<string, unknown> } | null)?.bar;
  if (!bar || typeof bar !== "object") {
    throw new AlpacaMarketDataError("Alpaca Market Data returned an unexpected response", 502);
  }
  return {
    symbol,
    timestamp: typeof bar.t === "string" ? bar.t : "",
    open: safeNumber(bar.o),
    high: safeNumber(bar.h),
    low: safeNumber(bar.l),
    close: safeNumber(bar.c),
    volume: safeNumber(bar.v),
    tradeCount: safeNumber(bar.n),
    vwap: safeNumber(bar.vw),
    feed,
    source: "alpaca",
  };
}

async function requestLatestBar(symbol: string, feed: AlpacaFeed): Promise<NormalizedAlpacaBar> {
  const url = new URL(`/v2/stocks/${encodeURIComponent(symbol)}/bars/latest`, BASE_URL);
  url.searchParams.set("feed", feed);
  return normalizeBar(symbol, feed, await requestJson(url));
}

async function requestLatestLiveQuotes(
  symbols: string[],
  feed: AlpacaFeed,
): Promise<NormalizedAlpacaLiveQuote[]> {
  const symbolList = symbols.join(",");
  const tradeUrl = new URL("/v2/stocks/trades/latest", BASE_URL);
  tradeUrl.searchParams.set("symbols", symbolList);
  tradeUrl.searchParams.set("feed", feed);
  const quoteUrl = new URL("/v2/stocks/quotes/latest", BASE_URL);
  quoteUrl.searchParams.set("symbols", symbolList);
  quoteUrl.searchParams.set("feed", feed);

  const [tradeBody, quoteBody] = await Promise.all([requestJson(tradeUrl), requestJson(quoteUrl)]);
  const trades = (tradeBody as { trades?: Record<string, Record<string, unknown>> } | null)?.trades ?? {};
  const latestQuotes = (quoteBody as { quotes?: Record<string, Record<string, unknown>> } | null)?.quotes ?? {};

  return symbols.map((symbol) => {
    const trade = trades[symbol] ?? {};
    const quote = latestQuotes[symbol] ?? {};
    const bidPrice = safeNumber(quote.bp);
    const askPrice = safeNumber(quote.ap);
    const tradePrice = safeNumber(trade.p);
    const midpoint = bidPrice !== null && askPrice !== null ? (bidPrice + askPrice) / 2 : null;
    const tradeTimestamp = safeTimestamp(trade.t);
    const quoteTimestamp = safeTimestamp(quote.t);
    return {
      symbol,
      price: tradePrice ?? midpoint,
      bidPrice,
      askPrice,
      tradeTimestamp,
      quoteTimestamp,
      timestamp: latestTimestamp(tradeTimestamp, quoteTimestamp),
      feed,
      source: "alpaca" as const,
    };
  });
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

export async function getLatestAlpacaLiveQuotes(symbolInput: unknown): Promise<NormalizedAlpacaLiveQuote[]> {
  const symbols = normalizeTickerSymbols(symbolInput);
  const feed = getConfiguredAlpacaFeed();
  try {
    return await requestLatestLiveQuotes(symbols, feed);
  } catch (error) {
    if (error instanceof AlpacaMarketDataError && feed === "sip" && error.upstreamStatus === 403) {
      const fallback = await requestLatestLiveQuotes(symbols, "iex");
      return fallback.map((item) => ({ ...item, fallbackUsed: "iex" as const }));
    }
    throw error;
  }
}
