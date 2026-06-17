import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Mock price database — replace individual entries with Robinhood quote data
// TODO: Robinhood integration
// GET https://api.robinhood.com/quotes/?symbols=AAPL,TSLA
// or per-symbol: GET https://api.robinhood.com/quotes/AAPL/
// Requires: Authorization: Bearer <access_token>
// Key fields to map: last_trade_price, previous_close, ask_price, bid_price, updated_at
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
};

function buildQuote(symbol: string) {
  const upper = symbol.toUpperCase();
  const mock = MOCK_QUOTES[upper];

  if (!mock) return null;

  const change = parseFloat((mock.price - mock.previousClose).toFixed(2));
  const changePercent = parseFloat(
    ((change / mock.previousClose) * 100).toFixed(2),
  );

  return {
    symbol: upper,
    price: mock.price,
    change,
    changePercent,
    previousClose: mock.previousClose,
    timestamp: new Date().toISOString(),
    source: "mock",
    // TODO: When Robinhood is connected, set source: "robinhood"
    // and populate from: last_trade_price, previous_close, updated_at
  };
}

router.get("/quotes", (req, res) => {
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

  const found: ReturnType<typeof buildQuote>[] = [];
  const notFound: string[] = [];

  for (const sym of requested) {
    const quote = buildQuote(sym);
    if (quote) {
      found.push(quote);
    } else {
      notFound.push(sym);
    }
  }

  res.json({
    success: true,
    count: found.length,
    data: found,
    ...(notFound.length > 0 && { not_found: notFound }),
  });
});

export default router;
