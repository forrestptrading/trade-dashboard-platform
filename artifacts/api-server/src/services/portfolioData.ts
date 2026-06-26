/**
 * Shared portfolio data layer for the analytics, risk, and performance services.
 *
 * Produces a normalized PortfolioSnapshot either from live broker data (via the
 * broker abstraction) or from a rich mock dataset when live data is unavailable.
 * The broker abstraction is never bypassed — we only call BrokerClient methods.
 */
import { useLiveData, type BrokerClient } from "../broker/index.js";
import { logger } from "../lib/logger.js";

export interface RawHolding {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  previousClose: number;
  sector: string;
  broker: string;
}

export interface Holding extends RawHolding {
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  dayChange: number;
}

export interface PortfolioSnapshot {
  source: string; // "mock" | brokerId
  cash: number;
  totalValue: number;
  investedValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalPL: number;
  totalPLPercent: number;
  holdings: Holding[];
}

const SECTOR_MAP: Record<string, string> = {
  AAPL: "Technology",
  MSFT: "Technology",
  NVDA: "Technology",
  GOOGL: "Technology",
  META: "Technology",
  TSLA: "Consumer Discretionary",
  AMZN: "Consumer Discretionary",
  HD: "Consumer Discretionary",
  JPM: "Financials",
  BAC: "Financials",
  GS: "Financials",
  XOM: "Energy",
  CVX: "Energy",
  JNJ: "Healthcare",
  UNH: "Healthcare",
  PFE: "Healthcare",
  KO: "Consumer Staples",
  PG: "Consumer Staples",
  SPY: "Index / ETF",
  QQQ: "Index / ETF",
};

export function sectorFor(symbol: string): string {
  return SECTOR_MAP[symbol.toUpperCase()] ?? "Other";
}

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function enrich(raw: RawHolding): Holding {
  const marketValue = raw.quantity * raw.currentPrice;
  const costBasis = raw.quantity * raw.averageCost;
  const unrealizedPL = marketValue - costBasis;
  const unrealizedPLPercent = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;
  const dayChange = raw.quantity * (raw.currentPrice - raw.previousClose);
  return {
    ...raw,
    marketValue: round(marketValue),
    costBasis: round(costBasis),
    unrealizedPL: round(unrealizedPL),
    unrealizedPLPercent: round(unrealizedPLPercent),
    dayChange: round(dayChange),
  };
}

export function buildSnapshot(
  source: string,
  cash: number,
  raws: RawHolding[],
): PortfolioSnapshot {
  const holdings = raws.map(enrich);
  const investedValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const totalValue = investedValue + cash;
  const dayChange = holdings.reduce((s, h) => s + h.dayChange, 0);
  const totalCost = holdings.reduce((s, h) => s + h.costBasis, 0);
  const totalPL = holdings.reduce((s, h) => s + h.unrealizedPL, 0);
  const prevValue = totalValue - dayChange;

  return {
    source,
    cash: round(cash),
    totalValue: round(totalValue),
    investedValue: round(investedValue),
    dayChange: round(dayChange),
    dayChangePercent: round(prevValue > 0 ? (dayChange / prevValue) * 100 : 0),
    totalPL: round(totalPL),
    totalPLPercent: round(totalCost > 0 ? (totalPL / totalCost) * 100 : 0),
    holdings,
  };
}

const MOCK_CASH = 12450.32;

const MOCK_RAW: RawHolding[] = [
  { symbol: "AAPL", quantity: 50, averageCost: 150.0, currentPrice: 189.45, previousClose: 187.1, sector: "Technology", broker: "robinhood" },
  { symbol: "MSFT", quantity: 30, averageCost: 300.0, currentPrice: 379.2, previousClose: 376.0, sector: "Technology", broker: "robinhood" },
  { symbol: "NVDA", quantity: 40, averageCost: 400.0, currentPrice: 525.3, previousClose: 540.1, sector: "Technology", broker: "schwab" },
  { symbol: "TSLA", quantity: 25, averageCost: 280.0, currentPrice: 245.6, previousClose: 250.2, sector: "Consumer Discretionary", broker: "robinhood" },
  { symbol: "AMZN", quantity: 20, averageCost: 130.0, currentPrice: 178.4, previousClose: 176.0, sector: "Consumer Discretionary", broker: "schwab" },
  { symbol: "JPM", quantity: 35, averageCost: 150.0, currentPrice: 198.75, previousClose: 197.5, sector: "Financials", broker: "fidelity" },
  { symbol: "XOM", quantity: 60, averageCost: 100.0, currentPrice: 112.3, previousClose: 113.8, sector: "Energy", broker: "fidelity" },
  { symbol: "JNJ", quantity: 30, averageCost: 160.0, currentPrice: 152.1, previousClose: 151.4, sector: "Healthcare", broker: "robinhood" },
  { symbol: "SPY", quantity: 15, averageCost: 420.0, currentPrice: 558.2, previousClose: 555.0, sector: "Index / ETF", broker: "robinhood" },
  { symbol: "KO", quantity: 80, averageCost: 55.0, currentPrice: 62.4, previousClose: 62.1, sector: "Consumer Staples", broker: "schwab" },
];

export function mockSnapshot(): PortfolioSnapshot {
  return buildSnapshot("mock", MOCK_CASH, MOCK_RAW);
}

/**
 * Build a snapshot from the given broker when live data is enabled and the
 * broker is authenticated; otherwise (or on any failure) return mock data.
 */
export async function getPortfolioSnapshot(
  broker: BrokerClient,
): Promise<PortfolioSnapshot> {
  if (useLiveData() && broker.isAuthenticated()) {
    try {
      const [holdings, account, portfolio] = await Promise.all([
        broker.getHoldings(),
        broker.getAccount(),
        broker.getPortfolio(),
      ]);

      if (holdings.length > 0) {
        const cash = Number(account.cash) || 0;
        const raws: RawHolding[] = holdings.map((h) => {
          const currentPrice =
            h.current_price ?? (h.quantity ? h.market_value / h.quantity : 0);
          return {
            symbol: h.symbol,
            quantity: h.quantity,
            averageCost: h.average_cost ?? 0,
            currentPrice,
            // Intraday previous close is not part of getHoldings(); approximate
            // with current price so per-holding day change is 0, then override
            // total day change from portfolio-level figures below.
            previousClose: currentPrice,
            sector: sectorFor(h.symbol),
            broker: broker.brokerId,
          };
        });

        const snap = buildSnapshot(broker.brokerId, cash, raws);
        const equity = Number(portfolio.equity) || snap.totalValue;
        const prev =
          Number(portfolio.adjusted_equity_previous_close) || equity;
        snap.dayChange = Math.round((equity - prev) * 100) / 100;
        snap.dayChangePercent =
          prev > 0 ? Math.round((snap.dayChange / prev) * 10000) / 100 : 0;
        return snap;
      }
    } catch (err) {
      logger.warn(
        `[portfolioData] live snapshot failed, using mock: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return mockSnapshot();
}
