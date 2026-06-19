import { Router, type IRouter } from "express";
import { useLiveData, robinhoodClient } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_PORTFOLIO = {
  account_number: "MOCK-12345678",
  total_value: 52341.87,
  cash: 3241.56,
  invested_value: 49100.31,
  day_change: 412.34,
  day_change_percent: 0.79,
  total_return: 7241.87,
  total_return_percent: 16.07,
  buying_power: 3241.56,
  currency: "USD",
  updated_at: new Date().toISOString(),
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
