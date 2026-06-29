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
import type { BrokerClient, BrokerHolding, OrderRequest } from "./brokerClient.js";
import type {
  BrokerAccountSummary,
  BrokerDividend as NormalizedBrokerDividend,
  BrokerHoldingPosition,
  BrokerMoney,
  BrokerOptionPosition,
  BrokerOrder as NormalizedBrokerOrder,
  BrokerSyncStatus,
  BrokerTransaction,
  NormalizedBrokerSnapshot,
} from "./model.js";
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

function usd(value: unknown): BrokerMoney {
  const amount = Number(value);
  return { amount: Number.isFinite(amount) ? amount : 0, currency: "USD" };
}

function percent(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

// ── Client ──────────────────────────────────────────────────────────────────

class RobinhoodClient implements BrokerClient {
  readonly brokerId = "robinhood";

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
   * Normalized holdings: fetches positions and resolves each instrument to a
   * ticker symbol. Returns the shape consumed by the /portfolio route.
   * Requires ROBINHOOD_ACCESS_TOKEN.
   */
  async getHoldings(): Promise<BrokerHolding[]> {
    const positionsPage = await this.getPositions();
    const positions = positionsPage.results ?? [];

    if (positions.length === 0) return [];

    const symbolMap = await this.resolveSymbols(positions);

    return positions
      .map((position) => {
        const symbol =
          symbolMap.get(position.instrument_id) ||
          position.instrument_id ||
          "UNKNOWN";

        const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const quantity = num(position.quantity);
        const averageCost = num(position.average_buy_price);
        const marketValue = num(position.equity);
        const currentPrice = quantity > 0 ? marketValue / quantity : 0;

        return {
          symbol,
          quantity,
          average_cost: averageCost,
          current_price: currentPrice,
          market_value: marketValue,
          account_name: "Robinhood",
        };
      })
      .filter((h) => h.quantity > 0);
  }

  async getAccountSummary(): Promise<BrokerAccountSummary> {
    const [portfolio, account, holdings] = await Promise.all([
      this.getPortfolio(),
      this.getAccount(),
      this.getHoldings(),
    ]);
    const equity = Number(portfolio.equity);
    const previousClose = Number(
      portfolio.adjusted_equity_previous_close ?? portfolio.equity_previous_close,
    );
    const investedValue = Number(portfolio.market_value);
    const dayChange =
      Number.isFinite(equity) && Number.isFinite(previousClose) ? equity - previousClose : 0;
    const totalReturn = Number(portfolio.net_return);

    return {
      brokerId: this.brokerId,
      accountId: account.id || account.account_number,
      accountNumber: account.account_number,
      accountName: "Robinhood",
      institutionName: "Robinhood",
      accountType: account.type === "cash" || account.type === "margin" ? account.type : "unknown",
      totalValue: usd(portfolio.equity),
      cash: usd(account.cash),
      buyingPower: usd(account.buying_power),
      investedValue: usd(
        Number.isFinite(investedValue)
          ? investedValue
          : holdings.reduce((sum, holding) => sum + holding.market_value, 0),
      ),
      dayChange: usd(dayChange),
      dayChangePercent: previousClose > 0 ? (dayChange / previousClose) * 100 : 0,
      totalReturn: usd(totalReturn),
      totalReturnPercent: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  async getCash(): Promise<BrokerMoney> {
    const account = await this.getAccount();
    return usd(account.cash);
  }

  async getBuyingPower(): Promise<BrokerMoney> {
    const account = await this.getAccount();
    return usd(account.buying_power);
  }

  async getNormalizedHoldings(): Promise<BrokerHoldingPosition[]> {
    const holdings = await this.getHoldings();

    return holdings.map((holding) => {
      const currentPrice = holding.current_price ?? 0;
      const averageCost = holding.average_cost ?? 0;
      const totalGainLoss = holding.market_value - averageCost * holding.quantity;

      return {
        brokerId: this.brokerId,
        accountName: holding.account_name,
        symbol: holding.symbol,
        quantity: holding.quantity,
        averageCost: usd(averageCost),
        currentPrice: usd(currentPrice),
        marketValue: usd(holding.market_value),
        totalGainLoss: usd(totalGainLoss),
        totalGainLossPercent:
          averageCost > 0 ? (totalGainLoss / (averageCost * holding.quantity)) * 100 : 0,
        assetType: "equity",
      };
    });
  }

  async getNormalizedOptions(): Promise<BrokerOptionPosition[]> {
    const page = await this.getOptionsPositions();

    return (page.results ?? []).map((position) => ({
      brokerId: this.brokerId,
      symbol: position.chain_symbol,
      underlyingSymbol: position.chain_symbol,
      quantity: percent(position.quantity),
      marketValue: usd(position.intraday_average_open_price),
      contractType: "unknown",
    }));
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

  /**
   * Options chain lookup for a single symbol.
   * TODO: implement against GET /options/instruments/?chain_symbol=<symbol>.
   * Not yet wired to any route — throws until implemented so callers fall back.
   */
  async getOptions(
    symbol: string,
  ): Promise<RobinhoodPaginated<RobinhoodOptionsPosition>> {
    throw new Error(
      `[RobinhoodClient] getOptions(${symbol}) is not implemented yet.`,
    );
  }

  // ── Trading (disabled — read-only integration) ───────────────────────────────

  /**
   * Placing orders is intentionally disabled — this integration is read-only.
   * TODO: implement authenticated order placement (POST /orders/) behind an
   * explicit opt-in once a secure trading flow and approvals exist.
   */
  async placeOrder(order: OrderRequest): Promise<RobinhoodOrder> {
    throw new Error(
      `[RobinhoodClient] placeOrder is disabled — this integration is read-only ` +
        `(requested ${order.side} ${order.quantity} ${order.symbol}).`,
    );
  }

  /**
   * Cancelling orders is intentionally disabled — this integration is read-only.
   * TODO: implement authenticated cancellation (POST /orders/<id>/cancel/) behind
   * an explicit opt-in once a secure trading flow and approvals exist.
   */
  async cancelOrder(orderId: string): Promise<void> {
    throw new Error(
      `[RobinhoodClient] cancelOrder is disabled — this integration is read-only ` +
        `(orderId=${orderId}).`,
    );
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

  async getTransactions(): Promise<BrokerTransaction[]> {
    const orders = await this.getOrders({ limit: 100 });

    return (orders.results ?? []).map((order) => ({
      brokerId: this.brokerId,
      id: order.id,
      symbol: order.instrument_id || undefined,
      type: order.side === "buy" || order.side === "sell" ? order.side : "other",
      amount: usd(order.price),
      quantity: percent(order.quantity),
      price: usd(order.price),
      tradeDate: order.created_at,
      description: `${order.side} ${order.quantity} ${order.instrument_id}`,
    }));
  }

  async getNormalizedDividends(): Promise<NormalizedBrokerDividend[]> {
    const dividends = await this.getDividends();

    return (dividends.results ?? []).map((dividend) => ({
      brokerId: this.brokerId,
      id: dividend.id,
      symbol: dividend.instrument || "UNKNOWN",
      amount: usd(dividend.amount),
      payableDate: dividend.payable_date,
      recordDate: dividend.record_date,
      status:
        dividend.state === "paid" || dividend.state === "pending"
          ? dividend.state
          : "unknown",
    }));
  }

  async getNormalizedOrders(): Promise<NormalizedBrokerOrder[]> {
    const orders = await this.getOrders({ limit: 100 });

    return (orders.results ?? []).map((order) => ({
      brokerId: this.brokerId,
      id: order.id,
      symbol: order.instrument_id,
      side: order.side,
      quantity: percent(order.quantity),
      orderType: order.type === "market" || order.type === "limit" ? order.type : "unknown",
      status:
        order.state === "queued" ||
        order.state === "filled" ||
        order.state === "cancelled" ||
        order.state === "rejected"
          ? order.state
          : order.state === "confirmed"
            ? "open"
            : "unknown",
      limitPrice: order.price ? usd(order.price) : undefined,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    }));
  }

  async getSyncStatus(): Promise<BrokerSyncStatus> {
    return {
      brokerId: this.brokerId,
      state: this.isAuthenticated() ? "connected" : "not_configured",
      lastSyncAt: this.isAuthenticated() ? new Date().toISOString() : null,
      message: this.isAuthenticated()
        ? "Robinhood access token configured."
        : "Robinhood access token is not configured.",
    };
  }

  async getNormalizedSnapshot(): Promise<NormalizedBrokerSnapshot> {
    const [accountSummary, holdings, options, transactions, dividends, orders, syncStatus] =
      await Promise.all([
        this.getAccountSummary(),
        this.getNormalizedHoldings(),
        this.getNormalizedOptions().catch(() => []),
        this.getTransactions().catch(() => []),
        this.getNormalizedDividends().catch(() => []),
        this.getNormalizedOrders().catch(() => []),
        this.getSyncStatus(),
      ]);

    return {
      brokerId: this.brokerId,
      source: this.brokerId,
      accountSummary,
      cash: accountSummary.cash,
      buyingPower: accountSummary.buyingPower,
      holdings,
      options,
      transactions,
      dividends,
      orders,
      syncStatus,
    };
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
