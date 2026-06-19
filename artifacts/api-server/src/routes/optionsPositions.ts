import { Router, type IRouter } from "express";
import { useLiveData, robinhoodClient } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_OPTIONS_POSITIONS = [
  {
    id: "opt-001",
    symbol: "AAPL",
    type: "call",
    strike: 195.0,
    expiration: "2026-07-18",
    quantity: 2,
    premium_paid: 3.45,
    current_premium: 4.82,
    market_value: 964.0,
    day_change: 0.37,
    day_change_percent: 7.13,
    total_return: 274.0,
    total_return_percent: 39.71,
    delta: 0.52,
    theta: -0.08,
    iv: 28.4,
    status: "open",
  },
  {
    id: "opt-002",
    symbol: "TSLA",
    type: "put",
    strike: 230.0,
    expiration: "2026-07-11",
    quantity: 1,
    premium_paid: 8.2,
    current_premium: 5.65,
    market_value: 565.0,
    day_change: -1.12,
    day_change_percent: -16.54,
    total_return: -255.0,
    total_return_percent: -31.1,
    delta: -0.43,
    theta: -0.14,
    iv: 54.7,
    status: "open",
  },
  {
    id: "opt-003",
    symbol: "NVDA",
    type: "call",
    strike: 900.0,
    expiration: "2026-08-15",
    quantity: 3,
    premium_paid: 22.5,
    current_premium: 31.8,
    market_value: 9540.0,
    day_change: 2.1,
    day_change_percent: 7.07,
    total_return: 2790.0,
    total_return_percent: 41.33,
    delta: 0.61,
    theta: -0.11,
    iv: 41.2,
    status: "open",
  },
];

router.get("/options/positions", async (_req, res) => {
  if (useLiveData()) {
    try {
      // Live: GET /options/positions/?nonzero=true
      // Each leg's option URL must be resolved for strike, expiration, type.
      // Greeks (delta, theta, iv) come from GET /marketdata/options/<id>/
      const live = await robinhoodClient.getOptionsPositions();

      // Stub: transformation + option detail resolution goes here when implemented.
      res.json({ success: true, source: "robinhood", count: live.results.length, data: live.results });
      return;
    } catch (err) {
      logger.warn(`[broker] getOptionsPositions failed, using mock: ${err instanceof Error ? err.message : err}`);
    }
  }

  res.json({
    success: true,
    source: "mock",
    count: MOCK_OPTIONS_POSITIONS.length,
    data: MOCK_OPTIONS_POSITIONS,
  });
});

export default router;
