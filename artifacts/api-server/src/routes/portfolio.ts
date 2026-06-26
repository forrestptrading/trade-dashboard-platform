import { Router, type IRouter } from "express";
import { useLiveData, getBroker, type BrokerClient } from "../broker/index.js";
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

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fetch holdings without throwing — a holdings failure should not collapse the
 * whole portfolio response. Returns [] on any error (matching prior behavior).
 */
async function getHoldingsSafe(broker: BrokerClient) {
  try {
    const holdings = await broker.getHoldings();
    logger.info(`[portfolio] getHoldings returned ${holdings.length} holding(s)`);
    return holdings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[broker] getHoldings failed: ${msg}`);
    return [];
  }
}

router.get("/portfolio", async (req, res) => {
  const live = useLiveData();
  logger.info(`[portfolio] useLiveData=${live}`);

  if (live) {
    try {
      const broker = getBroker(req.query["broker"] as string | undefined);
      const authenticated = broker.isAuthenticated();

      if (!authenticated) {
        logger.warn(
          "[portfolio] USE_LIVE_DATA=true but the broker is not authenticated — " +
            "portfolio/account endpoints require auth. Add the broker access token to Replit Secrets.",
        );
      }

      const [portfolio, account, holdings] = await Promise.all([
        broker.getPortfolio(),
        broker.getAccount(),
        getHoldingsSafe(broker),
      ]);

      const equity = number(portfolio.equity);
      const prevEquity = number(portfolio.adjusted_equity_previous_close);
      const cash = number(account.cash);
      const investedValue = number(portfolio.market_value);
      const dayChange = equity - prevEquity;

      logger.info(
        `[portfolio] live data fetched — equity=${equity} cash=${cash} holdings=${holdings.length}`,
      );

      res.json({
        success: true,
        source: broker.brokerId,
        data: {
          account_number: account.account_number,
          total_value: equity,
          cash,
          invested_value: investedValue,
          day_change: dayChange,
          day_change_percent:
            prevEquity > 0 ? (dayChange / prevEquity) * 100 : 0,
          total_return: number(portfolio.net_return),
          total_return_percent: 0,
          buying_power: number(account.buying_power),
          currency: "USD",
          updated_at: new Date().toISOString(),
          holdings,
        },
      });

      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[portfolio] live fetch failed — falling back to mock. Reason: ${msg}`);
    }
  }

  res.json({
    success: true,
    source: "mock",
    data: MOCK_PORTFOLIO,
  });
});

export default router;
