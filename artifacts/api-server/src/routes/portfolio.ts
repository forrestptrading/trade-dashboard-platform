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
  const client = robinhoodClient as any;

  try {
    let rawPositions: any = [];

    if (typeof client.getPositions === "function") {
      rawPositions = await client.getPositions();
    } else if (typeof client.getHoldings === "function") {
      rawPositions = await client.getHoldings();
    } else if (typeof client.getOpenPositions === "function") {
      rawPositions = await client.getOpenPositions();
    }

    if (!Array.isArray(rawPositions)) {
      rawPositions = rawPositions?.results || rawPositions?.data || [];
    }

    const holdings = rawPositions
      .map((position: any) => {
        const symbol =
          position.symbol ||
          position.ticker ||
          position.instrument_symbol ||
          position.name ||
          "UNKNOWN";

        const quantity = number(
          position.quantity ||
          position.shares ||
          position.qty ||
          position.units
        );

        const averageCost = number(
          position.average_buy_price ||
          position.average_cost ||
          position.avg_cost ||
          position.cost_basis_per_share
        );

        const currentPrice = number(
          position.current_price ||
          position.price ||
          position.last_price ||
          position.market_price
        );

        const marketValue = number(
          position.market_value ||
          position.value ||
          position.equity ||
          quantity * currentPrice
        );

        return {
          symbol,
          quantity,
          average_cost: averageCost,
          current_price: currentPrice,
          market_value: marketValue,
          account_name: "Robinhood",
        };
      })
      .filter((holding: any) => holding.quantity > 0);

    return holdings;
  } catch (err) {
    logger.warn(
      `[broker] getLiveHoldings failed: ${
        err instanceof Error ? err.message : err
      }`
    );

    return [];
  }
}

router.get("/portfolio", async (_req, res) => {
  if (useLiveData()) {
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
      logger.warn(
        `[broker] getPortfolio failed, using mock: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  res.json({
    success: true,
    source: "mock",
    data: MOCK_PORTFOLIO,
  });
});

export default router;
