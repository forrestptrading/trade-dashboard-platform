/**
 * RobinhoodClient — broker integration layer.
 *
 * Phase 2A: getQuotes() — live, public endpoint (no auth needed).
 * Phase 2B: getPortfolio(), getAccount(), getPositions() — live, requires
 *            ROBINHOOD_ACCESS_TOKEN in Replit Secrets.
 *
 * IMPORTANT:
 *  - Do NOT add order placement methods here.
 *  - Do NOT add approval action methods here.
 *  - Read-only data only.
 */

import { BROKER_CONFIG, buildRequestHeaders, getOptionalAccessToken } from "./config.js";
import type {
  BrokerSource,
  RobinhoodAccount,
  RobinhoodDividend,
  RobinhoodInstrument,
  RobinhoodOrder,
  RobinhoodOptionsPosition,
  RobinhoodPaginated,
  RobinhoodPortfolio,
  RobinhoodPosition,
  RobinhoodQuote,
  RobinhoodWatchlistItem,
} from "./types.js";

// ── Internal helpers ────────────────────────────────────────────────────────

async function fetchRobinhood<T>(
  urlOrPath: string,
  timeoutMs = 8_000,
): Promise<T> {
  const url = urlOrPath.startsWith("http")
    ? urlOrPath
    : `${BROKER_CONFIG.baseUrl}${urlOrPath}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildRequestHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `[RobinhoodClient] HTTP ${response.status} ${response.statusText} — ${url}` +
        (body ? `\n${body.slice(0, 200)}` : ""),
    );
  }

  return response.json() as Promise<T>;
}

/** Fetch all pages of a paginated endpoint and return the combined results. */
async function fetchAllPages<T>(firstPath: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | null = firstPath;

  while (next) {
    const page: RobinhoodPaginated<T> = await fetchRobinhood<RobinhoodPaginated<T>>(next);
    results.push(...page.results);
    next = page.next;
  }

  return results;
}

// ── Client ──────────────────────────────────────────────────────────────────

class RobinhoodClient {
  /**
   * Returns true when a valid access token is configured.
   */
  isAuthenticated(): boolean {
    return getOptionalAccessToken() !== null;
  }

  /**
   * Returns the data source label for response tagging.
   */
  source(): BrokerSource {
    return this.isAuthenticated() ? "robinhood" : "mock";
  }

  // ── Portfolio ──────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/portfolios/
   * Requires ROBINHOOD_ACCESS_TOKEN. Returns the first portfolio.
   */
  async getPortfolio(): Promise<RobinhoodPortfolio> {
    const page = await fetchRobinhood<RobinhoodPaginated<RobinhoodPortfolio>>(
      "/portfolios/",
    );

    if (!page.results || page.results.length === 0) {
      throw new Error("[RobinhoodClient] getPortfolio: no portfolios returned");
    }

    return page.results[0];
  }

  /**
   * GET https://api.robinhood.com/accounts/
   * Requires ROBINHOOD_ACCESS_TOKEN. Returns the first account.
   */
  async getAccount(): Promise<RobinhoodAccount> {
    const page = await fetchRobinhood<RobinhoodPaginated<RobinhoodAccount>>(
      "/accounts/",
    );

    if (!page.results || page.results.length === 0) {
      throw new Error("[RobinhoodClient] getAccount: no accounts returned");
    }

    return page.results[0];
  }

  // ── Positions ──────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/positions/?nonzero=true
   * Requires ROBINHOOD_ACCESS_TOKEN. Fetches all pages and returns combined.
   */
  async getPositions(): Promise<RobinhoodPaginated<RobinhoodPosition>> {
    const results = await fetchAllPages<RobinhoodPosition>(
      "/positions/?nonzero=true",
    );

    return { results, next: null, previous: null };
  }

  /**
   * Batch-resolve instrument IDs to ticker symbols.
   * Uses GET /instruments/?ids=id1,id2,... (chunked at 50 per request).
   * Returns a Map of instrument_id → symbol.
   */
  async resolveSymbols(positions: RobinhoodPosition[]): Promise<Map<string, string>> {
    const ids = [...new Set(positions.map((p) => p.instrument_id).filter(Boolean))];
    const symbolMap = new Map<string, string>();

    if (ids.length === 0) return symbolMap;

    const CHUNK = 50;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const page = await fetchRobinhood<RobinhoodPaginated<RobinhoodInstrument>>(
        `/instruments/?ids=${chunk.join(",")}`,
      );
      for (const instrument of page.results) {
        symbolMap.set(instrument.id, instrument.symbol);
      }
    }

    return symbolMap;
  }

  /**
   * GET https://api.robinhood.com/options/positions/?nonzero=true
   * Requires ROBINHOOD_ACCESS_TOKEN.
   */
  async getOptionsPositions(): Promise<
    RobinhoodPaginated<RobinhoodOptionsPosition>
  > {
    const results = await fetchAllPages<RobinhoodOptionsPosition>(
      "/options/positions/?nonzero=true",
    );
    return { results, next: null, previous: null };
  }

  // ── Quotes ─────────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/quotes/?symbols=AAPL,TSLA,NVDA
   * Phase 2A: LIVE — publicly accessible without auth.
   */
  async getQuotes(symbols: string[]): Promise<RobinhoodQuote[]> {
    if (symbols.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += 70) {
      chunks.push(symbols.slice(i, i + 70));
    }

    const results: RobinhoodQuote[] = [];

    for (const chunk of chunks) {
      const url = new URL(`${BROKER_CONFIG.baseUrl}/quotes/`);
      url.searchParams.set("symbols", chunk.join(","));

      const body = await fetchRobinhood<{ results: RobinhoodQuote[] }>(
        url.toString(),
      );

      if (!Array.isArray(body.results)) {
        throw new Error(
          "[RobinhoodClient] getQuotes: unexpected response shape — missing results[]",
        );
      }

      results.push(...body.results);
    }

    return results;
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────

  async getWatchlist(): Promise<RobinhoodPaginated<RobinhoodWatchlistItem>> {
    return fetchRobinhood<RobinhoodPaginated<RobinhoodWatchlistItem>>(
      "/watchlists/Default/",
    );
  }

  // ── Activity ───────────────────────────────────────────────────────────────

  async getOrders(
    options?: Partial<{ state: string; limit: number }>,
  ): Promise<RobinhoodPaginated<RobinhoodOrder>> {
    let path = "/orders/";
    const params: string[] = [];
    if (options?.state) params.push(`state=${options.state}`);
    if (options?.limit) params.push(`page_size=${options.limit}`);
    if (params.length > 0) path += `?${params.join("&")}`;

    const results = await fetchAllPages<RobinhoodOrder>(path);
    return { results, next: null, previous: null };
  }

  async getDividends(): Promise<RobinhoodPaginated<RobinhoodDividend>> {
    const results = await fetchAllPages<RobinhoodDividend>("/dividends/");
    return { results, next: null, previous: null };
  }

  // ── Market Data ────────────────────────────────────────────────────────────

  async getMarketHours(
    date: string,
  ): Promise<{ is_open: boolean; opens_at: string; closes_at: string }> {
    return fetchRobinhood(`/markets/XNAS/hours/${date}/`);
  }
}

// Singleton instance shared across all route handlers
export const robinhoodClient = new RobinhoodClient();
