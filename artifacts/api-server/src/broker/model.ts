/**
 * Broker Engine v1 normalized data model.
 *
 * This file is intentionally broker-agnostic. Adapter clients map native broker
 * payloads (Robinhood, Plaid-backed institutions, Schwab, etc.) into these
 * shapes before routes or services consume them.
 */

export type BrokerProviderId =
  | "robinhood"
  | "fidelity"
  | "vanguard"
  | "sofi"
  | "webull"
  | "schwab"
  | "interactive-brokers"
  | "etrade";

export type BrokerSyncState =
  | "connected"
  | "mock"
  | "offline"
  | "not_configured"
  | "not_implemented"
  | "error";

export interface BrokerMoney {
  amount: number;
  currency: "USD";
}

export interface BrokerAccountSummary {
  brokerId: BrokerProviderId;
  accountId: string;
  accountNumber?: string;
  accountName: string;
  institutionName: string;
  accountType?: "cash" | "margin" | "ira" | "crypto" | "unknown";
  totalValue: BrokerMoney;
  cash: BrokerMoney;
  buyingPower: BrokerMoney;
  investedValue: BrokerMoney;
  dayChange: BrokerMoney;
  dayChangePercent: number;
  totalReturn?: BrokerMoney;
  totalReturnPercent?: number;
  updatedAt: string;
}

export interface BrokerHoldingPosition {
  brokerId: BrokerProviderId;
  accountId?: string;
  accountName: string;
  symbol: string;
  quantity: number;
  averageCost?: BrokerMoney;
  currentPrice?: BrokerMoney;
  marketValue: BrokerMoney;
  dayChange?: BrokerMoney;
  dayChangePercent?: number;
  totalGainLoss?: BrokerMoney;
  totalGainLossPercent?: number;
  assetType?: "equity" | "etf" | "option" | "crypto" | "cash" | "unknown";
}

export interface BrokerOptionPosition {
  brokerId: BrokerProviderId;
  accountId?: string;
  symbol: string;
  underlyingSymbol?: string;
  quantity: number;
  marketValue?: BrokerMoney;
  expirationDate?: string;
  strikePrice?: number;
  contractType?: "call" | "put" | "unknown";
}

export interface BrokerTransaction {
  brokerId: BrokerProviderId;
  id: string;
  accountId?: string;
  symbol?: string;
  type: "buy" | "sell" | "dividend" | "deposit" | "withdrawal" | "fee" | "other";
  amount: BrokerMoney;
  quantity?: number;
  price?: BrokerMoney;
  tradeDate?: string;
  settledDate?: string;
  description?: string;
}

export interface BrokerDividend {
  brokerId: BrokerProviderId;
  id: string;
  accountId?: string;
  symbol: string;
  amount: BrokerMoney;
  payableDate?: string;
  recordDate?: string;
  status?: "pending" | "paid" | "cancelled" | "unknown";
}

export interface BrokerOrder {
  brokerId: BrokerProviderId;
  id: string;
  accountId?: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  orderType: "market" | "limit" | "stop" | "stop_limit" | "unknown";
  status: "queued" | "open" | "filled" | "cancelled" | "rejected" | "unknown";
  limitPrice?: BrokerMoney;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrokerSyncStatus {
  brokerId: BrokerProviderId;
  state: BrokerSyncState;
  lastSyncAt: string | null;
  message?: string;
}

export interface NormalizedBrokerSnapshot {
  brokerId: BrokerProviderId;
  source: BrokerProviderId | "mock";
  accountSummary: BrokerAccountSummary;
  cash: BrokerMoney;
  buyingPower: BrokerMoney;
  holdings: BrokerHoldingPosition[];
  options: BrokerOptionPosition[];
  transactions: BrokerTransaction[];
  dividends: BrokerDividend[];
  orders: BrokerOrder[];
  syncStatus: BrokerSyncStatus;
}
