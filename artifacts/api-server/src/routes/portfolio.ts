import { Router, type IRouter } from "express";
import { useLiveData, robinhoodClient } from "../broker/index.js";
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

async function getLiveHoldings() {
  try {
    const positionsPage = await robinhoodClient.getPositions();
    const positions = positionsPage.results ?? [];

    logger.info(`[broker] getPositions returned ${positions.length} position(s)`);

    if (positions.length === 0) return [];

    // Resolve instrument_id → ticker symbol in batch
    const symbolMap = await robinhoodClient.resolveSymbols(positions);

    const holdings = positions
      .map((position) => {
        const symbol =
          symbolMap.get(position.instrument_id) ||
          position.instrument_id ||
          "UNKNOWN";

        const quantity = number(position.quantity);
        const averageCost = number(position.average_buy_price);
        const marketValue = number(position.equity);
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

    return holdings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[broker] getLiveHoldings failed: ${msg}`);
    return [];
  }
}

router.get("/portfolio", async (_req, res) => {
  const live = useLiveData();
  const authenticated = robinhoodClient.isAuthenticated();

  logger.info(
    `[portfolio] useLiveData=${live} isAuthenticated=${authenticated}`,
  );

  if (live) {
    if (!authenticated) {
      logger.warn(
        "[portfolio] USE_LIVE_DATA=true but ROBINHOOD_ACCESS_TOKEN is not set — " +
          "portfolio/account endpoints require auth. Add ROBINHOOD_ACCESS_TOKEN to Replit Secrets.",
      );
    }

    try {
      const [portfolio, account, holdings] = await Promise.all([
        robinhoodClient.getPortfolio(),
        robinhoodClient.getAccount(),
        getLiveHoldings(),
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
        source: "robinhood",
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
