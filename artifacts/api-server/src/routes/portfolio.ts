import { Router, type IRouter } from "express";
import { useLiveData, robinhoodClient } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_HOLDINGS = [
  { symbol: "AAPL",  quantity: 10,  market_value: 2978.90, account_name: "Robinhood" },
  { symbol: "NVDA",  quantity: 15,  market_value: 3153.00, account_name: "Robinhood" },
  { symbol: "TSLA",  quantity: 8,   market_value: 3204.00, account_name: "Robinhood" },
  { symbol: "SPY",   quantity: 5,   market_value: 3732.85, account_name: "Robinhood" },
  { symbol: "MSFT",  quantity: 12,  market_value: 4408.44, account_name: "Robinhood" },
  { symbol: "GOOGL", quantity: 6,   market_value: 2073.54, account_name: "Robinhood" },
  { symbol: "META",  quantity: 20,  market_value: 9540.00, account_name: "Robinhood" },
  { symbol: "AMZN",  quantity: 7,   market_value: 1596.28, account_name: "Robinhood" },
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

router.get("/portfolio", async (_req, res) => {
  if (useLiveData()) {
    try {
      const [portfolio, account] = await Promise.all([
        robinhoodClient.getPortfolio(),
        robinhoodClient.getAccount(),
      ]);

      const equity = parseFloat(portfolio.equity);
      const prevEquity = parseFloat(portfolio.adjusted_equity_previous_close);
      const cash = parseFloat(account.cash);

      res.json({
        success: true,
        source: "robinhood",
        data: {
          account_number: account.account_number,
          total_value: equity,
          cash,
          invested_value: parseFloat(portfolio.market_value),
          day_change: equity - prevEquity,
          day_change_percent: prevEquity > 0 ? ((equity - prevEquity) / prevEquity) * 100 : 0,
          total_return: parseFloat(portfolio.net_return),
          total_return_percent: 0, // calculated downstream
          buying_power: parseFloat(account.buying_power),
          currency: "USD",
          updated_at: new Date().toISOString(),
          holdings: MOCK_HOLDINGS, // Phase 2B: replace with live positions
        },
      });
      return;
    } catch (err) {
      logger.warn(`[broker] getPortfolio failed, using mock: ${err instanceof Error ? err.message : err}`);
    }
  }

  res.json({ success: true, source: "mock", data: MOCK_PORTFOLIO });
});

export default router;
