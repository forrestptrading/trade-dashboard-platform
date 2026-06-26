import { Router, type IRouter } from "express";
import { useLiveData, getBroker } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_POSITIONS = [
  {
    id: "pos-001",
    symbol: "AAPL",
    name: "Apple Inc.",
    quantity: 15,
    average_buy_price: 172.34,
    current_price: 189.45,
    market_value: 2841.75,
    day_change: 1.23,
    day_change_percent: 0.65,
    total_return: 256.65,
    total_return_percent: 9.93,
    equity: 2841.75,
    percent_of_portfolio: 5.79,
  },
  {
    id: "pos-002",
    symbol: "TSLA",
    name: "Tesla, Inc.",
    quantity: 10,
    average_buy_price: 198.5,
    current_price: 242.17,
    market_value: 2421.7,
    day_change: -5.32,
    day_change_percent: -2.15,
    total_return: 436.7,
    total_return_percent: 21.99,
    equity: 2421.7,
    percent_of_portfolio: 4.94,
  },
  {
    id: "pos-003",
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    quantity: 8,
    average_buy_price: 412.0,
    current_price: 875.39,
    market_value: 7003.12,
    day_change: 22.45,
    day_change_percent: 2.63,
    total_return: 3707.12,
    total_return_percent: 112.55,
    equity: 7003.12,
    percent_of_portfolio: 14.29,
  },
  {
    id: "pos-004",
    symbol: "MSFT",
    name: "Microsoft Corporation",
    quantity: 20,
    average_buy_price: 310.45,
    current_price: 378.92,
    market_value: 7578.4,
    day_change: 3.11,
    day_change_percent: 0.83,
    total_return: 1369.4,
    total_return_percent: 22.05,
    equity: 7578.4,
    percent_of_portfolio: 15.46,
  },
  {
    id: "pos-005",
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    quantity: 25,
    average_buy_price: 142.8,
    current_price: 181.04,
    market_value: 4526.0,
    day_change: 0.87,
    day_change_percent: 0.48,
    total_return: 956.0,
    total_return_percent: 26.75,
    equity: 4526.0,
    percent_of_portfolio: 9.23,
  },
];

router.get("/positions", async (req, res) => {
  if (useLiveData()) {
    try {
      // Live: GET /positions/?nonzero=true
      // Each position.instrument URL must be resolved to symbol + name.
      // Transform shape to match our API contract before returning.
      const broker = getBroker(req.query["broker"] as string | undefined);
      const live = await broker.getPositions();

      // Stub: transformation logic goes here when implemented.
      // For now the stub throws, so this line is never reached.
      res.json({ success: true, source: broker.brokerId, count: live.results.length, data: live.results });
      return;
    } catch (err) {
      logger.warn(`[broker] getPositions failed, using mock: ${err instanceof Error ? err.message : err}`);
    }
  }

  res.json({ success: true, source: "mock", count: MOCK_POSITIONS.length, data: MOCK_POSITIONS });
});

export default router;
