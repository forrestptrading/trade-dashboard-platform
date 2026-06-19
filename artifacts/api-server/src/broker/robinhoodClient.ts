/**
 * RobinhoodClient — placeholder broker integration layer.
 *
 * All methods are STUBS. They throw a clear "not implemented" error.
 * No network calls are made. No credentials are read.
 *
 * This file defines the interface contract that the live implementation
 * will satisfy. When Phase 2 begins (live read-only data), replace each
 * stub body with the real fetch() call to api.robinhood.com.
 *
 * IMPORTANT:
 *  - Do NOT add order placement methods here.
 *  - Do NOT add approval action methods here.
 *  - Read-only data only.
 */

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
   * Returns real-time quotes for up to ~75 symbols per request.
   * Key fields: last_trade_price, previous_close, bid_price, ask_price.
   */
  async getQuotes(symbols: string[]): Promise<RobinhoodQuote[]> {
    throw NOT_IMPLEMENTED(`getQuotes(${symbols.join(",")})`);
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
