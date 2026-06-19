/**
 * RobinhoodClient — broker integration layer.
 *
 * Phase 2A: getQuotes() is live — calls api.robinhood.com/quotes/.
 * All other methods remain stubs — they throw NOT_IMPLEMENTED.
 *
 * IMPORTANT:
 *  - Do NOT add order placement methods here.
 *  - Do NOT add approval action methods here.
 *  - Read-only data only.
 */

import { BROKER_CONFIG, buildRequestHeaders } from "./config.js";
import type {
  BrokerSource,
  RobinhoodAccount,
  RobinhoodDividend,
  RobinhoodOrder,
  RobinhoodOptionsPosition,
  RobinhoodPaginated,
  RobinhoodPortfolio,
  RobinhoodPosition,
  RobinhoodQuote,
  RobinhoodWatchlistItem,
} from "./types.js";

const NOT_IMPLEMENTED = (method: string) =>
  new Error(
    `[RobinhoodClient] ${method} is not yet implemented. ` +
      "Set USE_LIVE_DATA=true only after credentials are configured and this method is implemented.",
  );

class RobinhoodClient {
  /**
   * Returns true when a valid access token is available.
   * Currently always false — no auth is implemented yet.
   */
  isAuthenticated(): boolean {
    return false;
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
   * Returns the first portfolio (most accounts have exactly one).
   */
  async getPortfolio(): Promise<RobinhoodPortfolio> {
    throw NOT_IMPLEMENTED("getPortfolio");
  }

  /**
   * GET https://api.robinhood.com/accounts/
   * Returns account details including cash, buying power, account number.
   */
  async getAccount(): Promise<RobinhoodAccount> {
    throw NOT_IMPLEMENTED("getAccount");
  }

  // ── Positions ──────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/positions/?nonzero=true
   * Returns all positions with a non-zero quantity.
   * Each position's `instrument` URL must be resolved to get the symbol.
   */
  async getPositions(): Promise<RobinhoodPaginated<RobinhoodPosition>> {
    throw NOT_IMPLEMENTED("getPositions");
  }

  /**
   * GET https://api.robinhood.com/options/positions/?nonzero=true
   * Returns open options positions. Each leg's `option` URL must be
   * resolved to get strike, expiration, and type.
   */
  async getOptionsPositions(): Promise<
    RobinhoodPaginated<RobinhoodOptionsPosition>
  > {
    throw NOT_IMPLEMENTED("getOptionsPositions");
  }

  // ── Quotes ─────────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/quotes/?symbols=AAPL,TSLA,NVDA
   *
   * Phase 2A: LIVE implementation.
   * The endpoint is publicly accessible without auth, but a bearer token
   * (ROBINHOOD_ACCESS_TOKEN) is used when available for better rate limits.
   * Throws on network failure or non-200 response so callers can fall back
   * to mock data.
   *
   * Never log or return the Authorization header value.
   */
  async getQuotes(symbols: string[]): Promise<RobinhoodQuote[]> {
    if (symbols.length === 0) return [];

    // Robinhood accepts up to ~75 symbols per request; chunk if needed
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += 70) {
      chunks.push(symbols.slice(i, i + 70));
    }

    const results: RobinhoodQuote[] = [];

    for (const chunk of chunks) {
      const url = new URL(`${BROKER_CONFIG.baseUrl}/quotes/`);
      url.searchParams.set("symbols", chunk.join(","));

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: buildRequestHeaders(),
        signal: AbortSignal.timeout(8_000), // 8s timeout per chunk
      });

      if (!response.ok) {
        throw new Error(
          `[RobinhoodClient] getQuotes HTTP ${response.status} for symbols: ${chunk.join(",")}`,
        );
      }

      const body = (await response.json()) as { results: RobinhoodQuote[] };

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

  /**
   * GET https://api.robinhood.com/watchlists/Default/
   * Returns the user's default watchlist.
   * Each item's `instrument` URL requires a second call to resolve the symbol.
   */
  async getWatchlist(): Promise<RobinhoodPaginated<RobinhoodWatchlistItem>> {
    throw NOT_IMPLEMENTED("getWatchlist");
  }

  // ── Activity ───────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/orders/
   * Returns all orders (paginated). Filter by state=filled for completed trades.
   * Each order's `instrument` URL requires a second call to resolve the symbol.
   */
  async getOrders(
    options?: Partial<{ state: string; limit: number }>,
  ): Promise<RobinhoodPaginated<RobinhoodOrder>> {
    throw NOT_IMPLEMENTED(`getOrders(${JSON.stringify(options ?? {})})`);
  }

  /**
   * GET https://api.robinhood.com/dividends/
   * Returns dividend history. Filter by state=paid for completed dividends.
   */
  async getDividends(): Promise<RobinhoodPaginated<RobinhoodDividend>> {
    throw NOT_IMPLEMENTED("getDividends");
  }

  // ── Market Data ────────────────────────────────────────────────────────────

  /**
   * GET https://api.robinhood.com/markets/XNAS/hours/<YYYY-MM-DD>/
   * Returns market hours for NASDAQ. Use for is_open, opens_at, closes_at.
   * Note: indices (SPY/QQQ/DIA) are fetched via getQuotes(), not this endpoint.
   */
  async getMarketHours(
    date: string,
  ): Promise<{ is_open: boolean; opens_at: string; closes_at: string }> {
    throw NOT_IMPLEMENTED(`getMarketHours(${date})`);
  }
}

// Singleton instance shared across all route handlers
export const robinhoodClient = new RobinhoodClient();
