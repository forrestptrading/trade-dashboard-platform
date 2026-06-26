import { Router, type IRouter } from "express";
import { useLiveData, getBroker } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_WATCHLIST = [
  {
    id: "wl-001",
    symbol: "META",
    name: "Meta Platforms, Inc.",
    current_price: 487.23,
    day_change: 8.41,
    day_change_percent: 1.75,
    week_52_high: 531.49,
    week_52_low: 279.4,
    market_cap: "1.25T",
    volume: 18_432_100,
    pe_ratio: 26.4,
    added_at: "2024-01-15T10:30:00.000Z",
  },
  {
    id: "wl-002",
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    current_price: 163.57,
    day_change: -1.12,
    day_change_percent: -0.68,
    week_52_high: 193.31,
    week_52_low: 115.83,
    market_cap: "2.03T",
    volume: 22_187_400,
    pe_ratio: 23.1,
    added_at: "2024-02-03T09:15:00.000Z",
  },
  {
    id: "wl-003",
    symbol: "AMD",
    name: "Advanced Micro Devices, Inc.",
    current_price: 167.42,
    day_change: 4.89,
    day_change_percent: 3.01,
    week_52_high: 227.3,
    week_52_low: 116.37,
    market_cap: "271B",
    volume: 34_901_200,
    pe_ratio: 45.2,
    added_at: "2024-03-10T14:00:00.000Z",
  },
  {
    id: "wl-004",
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    current_price: 512.87,
    day_change: 2.34,
    day_change_percent: 0.46,
    week_52_high: 524.61,
    week_52_low: 410.44,
    market_cap: "N/A",
    volume: 72_456_800,
    pe_ratio: null,
    added_at: "2024-01-02T08:00:00.000Z",
  },
  {
    id: "wl-005",
    symbol: "PLTR",
    name: "Palantir Technologies Inc.",
    current_price: 24.38,
    day_change: 0.63,
    day_change_percent: 2.65,
    week_52_high: 29.85,
    week_52_low: 13.65,
    market_cap: "53B",
    volume: 41_230_500,
    pe_ratio: 87.6,
    added_at: "2024-04-22T11:45:00.000Z",
  },
];

router.get("/watchlist", async (req, res) => {
  if (useLiveData()) {
    try {
      // Live: GET /watchlists/Default/
      // Each item.instrument URL requires a second call to resolve symbol + name.
      // Quotes (price, change) need a follow-up GET /quotes/?symbols=...
      const broker = getBroker(req.query["broker"] as string | undefined);
      const live = await broker.getWatchlist();

      // Stub: transformation + instrument resolution goes here when implemented.
      res.json({ success: true, source: broker.brokerId, count: live.results.length, data: live.results });
      return;
    } catch (err) {
      logger.warn(`[broker] getWatchlist failed, using mock: ${err instanceof Error ? err.message : err}`);
    }
  }

  res.json({ success: true, source: "mock", count: MOCK_WATCHLIST.length, data: MOCK_WATCHLIST });
});

export default router;
