import { Router, type IRouter } from "express";
import {
  useLiveData,
  getBroker,
  type BrokerClient,
  type BrokerHolding,
} from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_HOLDINGS = [
  { symbol: "AAPL", quantity: 10, market_value: 2978.9, account_name: "Robinhood" },
  { symbol: "NVDA", quantity: 15, market_value: 3153.0, account_name: "Robinhood" },
  { symbol: "TSLA", quantity: 8, market_value: 3204.0, account_name: "Robinhood" },
  { symbol: "SPY", quantity: 5, market_value: 3732.85, account_name: "Robinhood" },
];

const MOCK_PORTFOLIO = {
  account_number: "MOCK-12345678",
  total_value: 999999.99,
  cash: 77777.77,
  invested_value: 49100.31,
  day_change: 6666.66,
  day_change_percent: 12.34,
  total_return: 7241.87,
  total_return_percent: 16.07,
  buying_power: 88888.88,
  currency: "USD",
  updated_at: new Date().toISOString(),
  holdings: MOCK_HOLDINGS,
};

interface PortfolioResponseData {
  account_number: string;
  total_value: number;
  cash: number;
  invested_value: number;
  day_change: number;
  day_change_percent: number;
  total_return: number;
  total_return_percent: number;
  buying_power: number;
  currency: "USD";
  updated_at: string;
  holdings: BrokerHolding[];
}

function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseFiniteNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Robinhood portfolio field "${field}"`);
  }
  return parsed;
}

function parseOptionalFiniteNumber(value: unknown, field: string): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  return parseFiniteNumber(value, field);
}

function normalizeAccountNumber(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error('Invalid Robinhood account field "account_number"');
  }
  return value.trim();
}

function normalizeHolding(holding: BrokerHolding, index: number): BrokerHolding | null {
  const symbol = typeof holding.symbol === "string" ? holding.symbol.trim().toUpperCase() : "";
  const accountName =
    typeof holding.account_name === "string" && holding.account_name.trim()
      ? holding.account_name.trim()
      : "Robinhood";

  const quantity = Number(holding.quantity);
  const marketValue = Number(holding.market_value);
  const averageCost =
    holding.average_cost === undefined ? undefined : Number(holding.average_cost);
  const currentPrice =
    holding.current_price === undefined ? undefined : Number(holding.current_price);

  if (!symbol || !Number.isFinite(quantity) || quantity <= 0) {
    logger.warn({ index }, "[portfolio] skipping invalid Robinhood holding");
    return null;
  }

  if (!Number.isFinite(marketValue)) {
    logger.warn({ symbol }, "[portfolio] skipping Robinhood holding with invalid market value");
    return null;
  }

  return {
    symbol,
    quantity: round(quantity, 6),
    ...(Number.isFinite(averageCost) ? { average_cost: round(averageCost!, 6) } : {}),
    ...(Number.isFinite(currentPrice) ? { current_price: round(currentPrice!, 6) } : {}),
    market_value: round(marketValue),
    account_name: accountName,
  };
}

function normalizeHoldings(holdings: BrokerHolding[]): BrokerHolding[] {
  return holdings
    .map((holding, index) => normalizeHolding(holding, index))
    .filter((holding): holding is BrokerHolding => holding !== null);
}

function buildLivePortfolioData({
  portfolio,
  account,
  holdings,
}: {
  portfolio: Awaited<ReturnType<BrokerClient["getPortfolio"]>>;
  account: Awaited<ReturnType<BrokerClient["getAccount"]>>;
  holdings: BrokerHolding[];
}): PortfolioResponseData {
  const accountNumber = normalizeAccountNumber(account.account_number);
  const cash = parseFiniteNumber(account.cash, "account.cash");
  const buyingPower = parseFiniteNumber(account.buying_power, "account.buying_power");
  const equity = parseFiniteNumber(portfolio.equity, "portfolio.equity");
  const investedValue = parseOptionalFiniteNumber(portfolio.market_value, "portfolio.market_value");
  const prevEquity = parseOptionalFiniteNumber(
    portfolio.adjusted_equity_previous_close ?? portfolio.equity_previous_close,
    "portfolio.adjusted_equity_previous_close",
  );
  const totalReturn = parseOptionalFiniteNumber(portfolio.net_return, "portfolio.net_return");
  const dayChange = prevEquity > 0 ? equity - prevEquity : 0;

  return {
    account_number: accountNumber,
    total_value: round(equity),
    cash: round(cash),
    invested_value: round(investedValue),
    day_change: round(dayChange),
    day_change_percent: round(prevEquity > 0 ? (dayChange / prevEquity) * 100 : 0),
    total_return: round(totalReturn),
    total_return_percent: 0,
    buying_power: round(buyingPower),
    currency: "USD",
    updated_at: new Date().toISOString(),
    holdings: normalizeHoldings(holdings),
  };
}

/**
 * Fetch holdings without throwing — a holdings failure should not collapse the
 * whole portfolio response. Returns [] on any error (matching prior behavior).
 */
async function getHoldingsSafe(broker: BrokerClient) {
  try {
    const holdings = await broker.getHoldings();
    logger.info(
      { broker: broker.brokerId, count: holdings.length },
      "[portfolio] getHoldings returned holdings",
    );
    return holdings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ broker: broker.brokerId, err: msg }, "[portfolio] getHoldings failed");
    return [];
  }
}

router.get("/portfolio", async (req, res) => {
  const live = useLiveData();
  logger.info({ live }, "[portfolio] request received");

  if (live) {
    try {
      const broker = getBroker(req.query["broker"] as string | undefined);
      const authenticated = broker.isAuthenticated();

      if (!authenticated) {
        logger.warn(
          { broker: broker.brokerId },
          "[portfolio] live mode enabled but broker is not authenticated; falling back to mock",
        );
        throw new Error("Robinhood portfolio/account endpoints require an access token");
      }

      logger.info({ broker: broker.brokerId }, "[portfolio] fetching live portfolio data");

      const [portfolio, account, holdings] = await Promise.all([
        broker.getPortfolio(),
        broker.getAccount(),
        getHoldingsSafe(broker),
      ]);

      const data = buildLivePortfolioData({ portfolio, account, holdings });

      logger.info(
        {
          broker: broker.brokerId,
          totalValue: data.total_value,
          cash: data.cash,
          investedValue: data.invested_value,
          holdings: data.holdings.length,
        },
        "[portfolio] live portfolio data fetched successfully",
      );

      res.json({
        success: true,
        source: "robinhood" as const,
        data,
      });

      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, "[portfolio] live fetch failed; falling back to mock");
    }
  }

  logger.info("[portfolio] responding with mock portfolio data");
  res.json({
    success: true,
    source: "mock" as const,
    data: MOCK_PORTFOLIO,
  });
});

export default router;
