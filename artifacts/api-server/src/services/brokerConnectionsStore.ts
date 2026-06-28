import { randomUUID } from "node:crypto";
import type { BrokerHolding } from "../broker/index.js";

export type BrokerProvider = "robinhood" | "sofi" | "webull" | "schwab" | "fidelity";
export type BrokerConnectionStatus = "connected" | "disconnected" | "syncing" | "error";
export type BrokerAccountType = "brokerage" | "retirement" | "crypto";

export interface BrokerConnectionRecord {
  id: string;
  name: string;
  provider: BrokerProvider;
  status: BrokerConnectionStatus;
  account_type: BrokerAccountType;
  last_connected: string | null;
  balance: number;
  buying_power: number;
  holdings: BrokerHolding[];
}

const PROVIDER_NAMES: Record<BrokerProvider, string> = {
  robinhood: "Robinhood",
  sofi: "SoFi",
  webull: "Webull",
  schwab: "Schwab",
  fidelity: "Fidelity",
};

const MOCK_PROVIDER_DATA: Record<BrokerProvider, Pick<BrokerConnectionRecord, "balance" | "buying_power" | "holdings">> = {
  robinhood: {
    balance: 18642.38,
    buying_power: 2140.12,
    holdings: [
      { symbol: "AAPL", quantity: 12, average_cost: 172.34, current_price: 189.45, market_value: 2273.4, account_name: "Robinhood" },
      { symbol: "TSLA", quantity: 7, average_cost: 198.5, current_price: 242.17, market_value: 1695.19, account_name: "Robinhood" },
      { symbol: "SPY", quantity: 11, average_cost: 455.25, current_price: 512.87, market_value: 5641.57, account_name: "Robinhood" },
    ],
  },
  sofi: {
    balance: 12420.55,
    buying_power: 980.24,
    holdings: [
      { symbol: "VOO", quantity: 9, average_cost: 421.1, current_price: 461.22, market_value: 4150.98, account_name: "SoFi" },
      { symbol: "MSFT", quantity: 8, average_cost: 310.45, current_price: 378.92, market_value: 3031.36, account_name: "SoFi" },
    ],
  },
  webull: {
    balance: 9735.84,
    buying_power: 1250.0,
    holdings: [
      { symbol: "NVDA", quantity: 5, average_cost: 412, current_price: 875.39, market_value: 4376.95, account_name: "Webull" },
      { symbol: "AMD", quantity: 10, average_cost: 132.8, current_price: 167.42, market_value: 1674.2, account_name: "Webull" },
    ],
  },
  schwab: {
    balance: 32780.42,
    buying_power: 5430.8,
    holdings: [
      { symbol: "AMZN", quantity: 20, average_cost: 142.8, current_price: 181.04, market_value: 3620.8, account_name: "Schwab" },
      { symbol: "JPM", quantity: 25, average_cost: 150, current_price: 198.75, market_value: 4968.75, account_name: "Schwab" },
      { symbol: "QQQ", quantity: 16, average_cost: 382.1, current_price: 436.19, market_value: 6979.04, account_name: "Schwab" },
    ],
  },
  fidelity: {
    balance: 28410.9,
    buying_power: 3012.67,
    holdings: [
      { symbol: "META", quantity: 9, average_cost: 428.2, current_price: 487.23, market_value: 4385.07, account_name: "Fidelity" },
      { symbol: "JNJ", quantity: 18, average_cost: 160, current_price: 152.1, market_value: 2737.8, account_name: "Fidelity" },
      { symbol: "KO", quantity: 40, average_cost: 55, current_price: 62.4, market_value: 2496, account_name: "Fidelity" },
    ],
  },
};

const connections = new Map<string, BrokerConnectionRecord>();
const plaidAccessTokens = new Map<
  string,
  { accessToken: string; itemId: string; provider: BrokerProvider; storedAt: string }
>();

function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function brokerProviders(): BrokerProvider[] {
  return ["robinhood", "sofi", "webull", "schwab", "fidelity"];
}

export function isBrokerProvider(value: unknown): value is BrokerProvider {
  return typeof value === "string" && brokerProviders().includes(value as BrokerProvider);
}

export function providerDisplayName(provider: BrokerProvider): string {
  return PROVIDER_NAMES[provider];
}

export function listBrokerConnections(): BrokerConnectionRecord[] {
  return [...connections.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createBrokerConnection(input: {
  provider: BrokerProvider;
  name?: string;
  account_type?: BrokerAccountType;
}): BrokerConnectionRecord {
  const existing = listBrokerConnections().find((connection) => connection.provider === input.provider);
  if (existing) {
    const refreshed = refreshBrokerConnection(existing.id);
    if (!refreshed) throw new Error("Failed to refresh existing broker connection");
    return refreshed;
  }

  const providerData = MOCK_PROVIDER_DATA[input.provider];
  const name = input.name?.trim() || providerDisplayName(input.provider);
  const now = new Date().toISOString();
  const connection: BrokerConnectionRecord = {
    id: randomUUID(),
    name,
    provider: input.provider,
    status: "connected",
    account_type: input.account_type ?? "brokerage",
    last_connected: now,
    balance: providerData.balance,
    buying_power: providerData.buying_power,
    holdings: providerData.holdings,
  };

  connections.set(connection.id, connection);
  return connection;
}

export function updateBrokerConnection(
  id: string,
  input: Partial<Pick<BrokerConnectionRecord, "name" | "status" | "account_type">>,
): BrokerConnectionRecord | null {
  const connection = connections.get(id);
  if (!connection) return null;

  const nextStatus = input.status ?? connection.status;
  const updated: BrokerConnectionRecord = {
    ...connection,
    ...(input.name !== undefined ? { name: input.name.trim() || connection.name } : {}),
    ...(input.account_type !== undefined ? { account_type: input.account_type } : {}),
    status: nextStatus,
    last_connected: nextStatus === "connected" ? new Date().toISOString() : connection.last_connected,
  };

  connections.set(id, updated);
  return updated;
}

export function refreshBrokerConnection(id: string): BrokerConnectionRecord | null {
  const connection = connections.get(id);
  if (!connection) return null;
  const providerData = MOCK_PROVIDER_DATA[connection.provider];
  const refreshed: BrokerConnectionRecord = {
    ...connection,
    status: "connected",
    last_connected: new Date().toISOString(),
    balance: providerData.balance,
    buying_power: providerData.buying_power,
    holdings: providerData.holdings,
  };
  connections.set(id, refreshed);
  return refreshed;
}

export function deleteBrokerConnection(id: string): boolean {
  plaidAccessTokens.delete(id);
  return connections.delete(id);
}

export function storePlaidAccessToken(
  connectionId: string,
  input: { accessToken: string; itemId: string; provider: BrokerProvider },
): void {
  plaidAccessTokens.set(connectionId, {
    ...input,
    storedAt: new Date().toISOString(),
  });
}

export function connectedBrokerConnections(): BrokerConnectionRecord[] {
  return listBrokerConnections().filter((connection) => connection.status === "connected");
}

export function connectedBrokerPortfolio(): {
  total_value: number;
  cash: number;
  invested_value: number;
  buying_power: number;
  holdings: BrokerHolding[];
} | null {
  const connected = connectedBrokerConnections();
  if (connected.length === 0) return null;

  const holdings = connected.flatMap((connection) => connection.holdings);
  const totalValue = connected.reduce((sum, connection) => sum + connection.balance, 0);
  const buyingPower = connected.reduce((sum, connection) => sum + connection.buying_power, 0);
  const investedValue = Math.max(
    holdings.reduce((sum, holding) => sum + holding.market_value, 0),
    totalValue - buyingPower,
  );

  return {
    total_value: round(totalValue),
    cash: round(buyingPower),
    invested_value: round(investedValue),
    buying_power: round(buyingPower),
    holdings,
  };
}

export function connectedBrokerPositions(): Array<{
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  average_buy_price: number;
  current_price: number;
  market_value: number;
  day_change: number;
  day_change_percent: number;
  total_return: number;
  total_return_percent: number;
  equity: number;
  percent_of_portfolio: number;
}> {
  const portfolio = connectedBrokerPortfolio();
  if (!portfolio) return [];

  return portfolio.holdings.map((holding, index) => {
    const averageBuyPrice = holding.average_cost ?? 0;
    const currentPrice =
      holding.current_price ?? (holding.quantity > 0 ? holding.market_value / holding.quantity : 0);
    const costBasis = averageBuyPrice * holding.quantity;
    const totalReturn = holding.market_value - costBasis;

    return {
      id: `broker-${holding.account_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${holding.symbol.toLowerCase()}-${index}`,
      symbol: holding.symbol,
      name: `${holding.symbol} (${holding.account_name})`,
      quantity: holding.quantity,
      average_buy_price: round(averageBuyPrice),
      current_price: round(currentPrice),
      market_value: round(holding.market_value),
      day_change: 0,
      day_change_percent: 0,
      total_return: round(totalReturn),
      total_return_percent: round(costBasis > 0 ? (totalReturn / costBasis) * 100 : 0),
      equity: round(holding.market_value),
      percent_of_portfolio: round(
        portfolio.total_value > 0 ? (holding.market_value / portfolio.total_value) * 100 : 0,
      ),
    };
  });
}
