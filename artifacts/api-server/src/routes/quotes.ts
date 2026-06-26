import { Router, type IRouter } from "express";
import { useLiveData, getBroker } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MOCK_QUOTES: Record<string, { price: number; previousClose: number }> = {
  AAPL: { price: 189.45, previousClose: 188.22 },
  TSLA: { price: 242.17, previousClose: 247.49 },
  NVDA: { price: 875.39, previousClose: 852.94 },
  MSFT: { price: 378.92, previousClose: 375.81 },
  AMZN: { price: 181.04, previousClose: 180.17 },
  META: { price: 487.23, previousClose: 478.82 },
  GOOGL: { price: 163.57, previousClose: 164.69 },
  AMD: { price: 167.42, previousClose: 162.53 },
  SPY: { price: 512.87, previousClose: 510.53 },
  PLTR: { price: 24.38, previousClose: 23.75 },
  NFLX: { price: 628.41, previousClose: 621.88 },
  DIS: { price: 104.72, previousClose: 103.45 },
  COIN: { price: 215.63, previousClose: 208.91 },
  HOOD: { price: 18.42, previousClose: 17.87 },
  QQQ: { price: 436.19, previousClose: 432.74 },
  DIA: { price: 388.41, previousClose: 389.28 },
  IWM: { price: 208.63, previousClose: 207.51 },
};

function buildMockQuote(symbol: string) {
  const upper = symbol.toUpperCase();
  const mock = MOCK_QUOTES[upper];
  if (!mock) return null;

  const change = parseFloat((mock.price - mock.previousClose).toFixed(2));
  const changePercent = parseFloat(((change / mock.previousClose) * 100).toFixed(2));

  return {
    symbol: upper,
    price: mock.price,
    change,
    changePercent,
    previousClose: mock.previousClose,
    timestamp: new Date().toISOString(),
    source: "mock" as const,
  };
}

router.get("/quotes", async (req, res) => {
  const raw = req.query["symbols"];

  if (!raw || typeof raw !== "string") {
    res.status(400).json({
      success: false,
      error: 'Missing required query param: "symbols"',
      example: "/api/quotes?symbols=AAPL,TSLA,NVDA",
    });
    return;
  }

  const requested = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (requested.length === 0) {
    res.status(400).json({
      success: false,
      error: "No valid symbols provided",
      example: "/api/quotes?symbols=AAPL,TSLA,NVDA",
    });
    return;
  }

  if (useLiveData()) {
    try {
      // Live: GET /quotes/?symbols=AAPL,TSLA,NVDA
      // Fields: last_trade_price, previous_close, bid_price, ask_price, updated_at
      const broker = getBroker(req.query["broker"] as string | undefined);
      const live = await broker.getQuotes(requested);

      const data = live.map((q) => {
        const price = parseFloat(q.last_trade_price);
        const prev = parseFloat(q.previous_close);
        const change = parseFloat((price - prev).toFixed(2));
        return {
          symbol: q.symbol,
          price,
          change,
          changePercent: parseFloat(((change / prev) * 100).toFixed(2)),
          previousClose: prev,
          bidPrice: parseFloat(q.bid_price),
          askPrice: parseFloat(q.ask_price),
          timestamp: q.updated_at,
          source: broker.brokerId,
        };
      });

      res.json({ success: true, source: broker.brokerId, count: data.length, data });
      return;
    } catch (err) {
      logger.warn(`[broker] getQuotes failed, using mock: ${err instanceof Error ? err.message : err}`);
    }
  }

  const found: ReturnType<typeof buildMockQuote>[] = [];
  const notFound: string[] = [];

  for (const sym of requested) {
    const q = buildMockQuote(sym);
    if (q) found.push(q);
    else notFound.push(sym);
  }

  res.json({
    success: true,
    source: "mock",
    count: found.length,
    data: found,
    ...(notFound.length > 0 && { not_found: notFound }),
  });
});

router.get("/portfolio", async (_req, res) => {
  res.json({
    success: true,
    source: "demo-portfolio",
    portfolio: {
      totalValue: 52341.87,
      buyingPower: 3241.56,
      cash: 3241.56,
      dailyChange: 412.34,
      dailyPercent: 0.79,
      positions: [],
    },
  });
});

export default router;
