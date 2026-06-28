/**
 * Common broker abstraction.
 *
 * Every broker (Robinhood, Schwab, Fidelity, ...) implements BrokerClient, so
 * the BrokerManager and route handlers can treat all brokers uniformly.
 * Adding a new broker means writing a client that implements this interface
 * and registering it in manager.ts — no route or frontend changes required.
 *
 * The interface has two groups:
 *  1. Core cross-broker contract — the canonical method set every broker exposes.
 *  2. Extended read-only methods — additional reads the existing routes already
 *     depend on. Kept on the interface so routes stay fully typed and backward
 *     compatible while the abstraction is introduced.
 */

import type {
  BrokerAccountSummary,
  BrokerDividend,
  BrokerHoldingPosition,
  BrokerOptionPosition,
  BrokerProviderId,
  BrokerSyncStatus,
  BrokerTransaction,
  BrokerOrder as NormalizedBrokerOrder,
  NormalizedBrokerSnapshot,
  BrokerMoney,
} from "./model.js";
import type {
  RobinhoodAccount,
  RobinhoodDividend,
  RobinhoodOptionsPosition,
  RobinhoodOrder,
  RobinhoodPaginated,
  RobinhoodPortfolio,
  RobinhoodPosition,
  RobinhoodQuote,
  RobinhoodWatchlistItem,
} from "./types.js";

/** Normalized holding shape returned by getHoldings(). */
export interface BrokerHolding {
  symbol: string;
  quantity: number;
  average_cost?: number;
  current_price?: number;
  market_value: number;
  account_name: string;
}

/** Order request payload — used by the (future) trading methods. */
export interface OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  type?: "market" | "limit" | "stop_loss" | "stop_limit";
  price?: number;
  time_in_force?: "gfd" | "gtc" | "ioc" | "opg";
}

export interface BrokerClient {
  // ── Core cross-broker contract ──────────────────────────────────────────────
  getPortfolio(): Promise<RobinhoodPortfolio>;
  getHoldings(): Promise<BrokerHolding[]>;
  getQuotes(symbols: string[]): Promise<RobinhoodQuote[]>;
  getOptions(symbol: string): Promise<RobinhoodPaginated<RobinhoodOptionsPosition>>;
  getOrders(
    options?: Partial<{ state: string; limit: number }>,
  ): Promise<RobinhoodPaginated<RobinhoodOrder>>;
  placeOrder(order: OrderRequest): Promise<RobinhoodOrder>;
  cancelOrder(orderId: string): Promise<void>;
  isAuthenticated(): boolean;

  /** Stable identifier for this broker, e.g. "robinhood". Used as the response `source`. */
  readonly brokerId: BrokerProviderId;

  // ── Broker Engine v1 normalized contract ───────────────────────────────────
  getAccountSummary(): Promise<BrokerAccountSummary>;
  getCash(): Promise<BrokerMoney>;
  getBuyingPower(): Promise<BrokerMoney>;
  getNormalizedHoldings(): Promise<BrokerHoldingPosition[]>;
  getNormalizedOptions(): Promise<BrokerOptionPosition[]>;
  getTransactions(): Promise<BrokerTransaction[]>;
  getNormalizedDividends(): Promise<BrokerDividend[]>;
  getNormalizedOrders(): Promise<NormalizedBrokerOrder[]>;
  getSyncStatus(): Promise<BrokerSyncStatus>;
  getNormalizedSnapshot(): Promise<NormalizedBrokerSnapshot>;

  // ── Extended read-only methods (used by existing routes) ────────────────────
  getAccount(): Promise<RobinhoodAccount>;
  getPositions(): Promise<RobinhoodPaginated<RobinhoodPosition>>;
  resolveSymbols(positions: RobinhoodPosition[]): Promise<Map<string, string>>;
  getOptionsPositions(): Promise<RobinhoodPaginated<RobinhoodOptionsPosition>>;
  getWatchlist(): Promise<RobinhoodPaginated<RobinhoodWatchlistItem>>;
  getDividends(): Promise<RobinhoodPaginated<RobinhoodDividend>>;
}

/**
 * Base class for brokers that are not implemented yet.
 *
 * Every method throws a clear "not implemented" error so the route layer falls
 * back to mock data exactly the way it does for any other live failure.
 * Placeholder brokers extend this and only declare their `brokerId`.
 */
export abstract class BaseBrokerClient implements BrokerClient {
  abstract readonly brokerId: BrokerProviderId;

  protected notImplemented(method: string): never {
    throw new Error(
      `[${this.constructor.name}] ${method} is not implemented yet for this broker.`,
    );
  }

  getPortfolio(): Promise<RobinhoodPortfolio> {
    return this.notImplemented("getPortfolio");
  }
  getHoldings(): Promise<BrokerHolding[]> {
    return this.notImplemented("getHoldings");
  }
  getQuotes(_symbols: string[]): Promise<RobinhoodQuote[]> {
    return this.notImplemented("getQuotes");
  }
  getOptions(
    _symbol: string,
  ): Promise<RobinhoodPaginated<RobinhoodOptionsPosition>> {
    return this.notImplemented("getOptions");
  }
  getOrders(
    _options?: Partial<{ state: string; limit: number }>,
  ): Promise<RobinhoodPaginated<RobinhoodOrder>> {
    return this.notImplemented("getOrders");
  }
  placeOrder(_order: OrderRequest): Promise<RobinhoodOrder> {
    return this.notImplemented("placeOrder");
  }
  cancelOrder(_orderId: string): Promise<void> {
    return this.notImplemented("cancelOrder");
  }
  isAuthenticated(): boolean {
    return false;
  }
  getAccountSummary(): Promise<BrokerAccountSummary> {
    return this.notImplemented("getAccountSummary");
  }
  getCash(): Promise<BrokerMoney> {
    return this.notImplemented("getCash");
  }
  getBuyingPower(): Promise<BrokerMoney> {
    return this.notImplemented("getBuyingPower");
  }
  getNormalizedHoldings(): Promise<BrokerHoldingPosition[]> {
    return this.notImplemented("getNormalizedHoldings");
  }
  getNormalizedOptions(): Promise<BrokerOptionPosition[]> {
    return this.notImplemented("getNormalizedOptions");
  }
  getTransactions(): Promise<BrokerTransaction[]> {
    return this.notImplemented("getTransactions");
  }
  getNormalizedDividends(): Promise<BrokerDividend[]> {
    return this.notImplemented("getNormalizedDividends");
  }
  getNormalizedOrders(): Promise<NormalizedBrokerOrder[]> {
    return this.notImplemented("getNormalizedOrders");
  }
  getSyncStatus(): Promise<BrokerSyncStatus> {
    return this.notImplemented("getSyncStatus");
  }
  getNormalizedSnapshot(): Promise<NormalizedBrokerSnapshot> {
    return this.notImplemented("getNormalizedSnapshot");
  }
  getAccount(): Promise<RobinhoodAccount> {
    return this.notImplemented("getAccount");
  }
  getPositions(): Promise<RobinhoodPaginated<RobinhoodPosition>> {
    return this.notImplemented("getPositions");
  }
  resolveSymbols(
    _positions: RobinhoodPosition[],
  ): Promise<Map<string, string>> {
    return this.notImplemented("resolveSymbols");
  }
  getOptionsPositions(): Promise<
    RobinhoodPaginated<RobinhoodOptionsPosition>
  > {
    return this.notImplemented("getOptionsPositions");
  }
  getWatchlist(): Promise<RobinhoodPaginated<RobinhoodWatchlistItem>> {
    return this.notImplemented("getWatchlist");
  }
  getDividends(): Promise<RobinhoodPaginated<RobinhoodDividend>> {
    return this.notImplemented("getDividends");
  }
}
