import { Router, type IRouter } from "express";

const router: IRouter = Router();

// In-memory price state — seeded from mock baseline, mutated on each refresh call
// TODO: Robinhood integration
// GET https://api.robinhood.com/quotes/?symbols=AAPL,TSLA,...
// Replace the in-memory state with a live fetch and remove the fluctuation logic.
// Requires: Authorization: Bearer <access_token>

const priceState: Record<string, { price: number; previousClose: number }> = {
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

// Applies a small random walk to a price (±0.5% max per refresh)
function fluctuate(price: number): number {
  const bps = (Math.random() - 0.5) * 0.01; // ±0.5%
  return parseFloat((price * (1 + bps)).toFixed(2));
}

function buildRefreshedQuote(symbol: string) {
  const state = priceState[symbol];
  if (!state) return null;

  // Mutate in-memory price so successive refreshes show movement
  state.price = fluctuate(state.price);

  const change = parseFloat((state.price - state.previousClose).toFixed(2));
  const changePercent = parseFloat(
    ((change / state.previousClose) * 100).toFixed(2),
  );

  return {
    symbol,
    price: state.price,
    change,
    changePercent,
    previousClose: state.previousClose,
    timestamp: new Date().toISOString(),
    source: "mock",
    // TODO: set source: "robinhood" when live data is wired in
  };
}

// POST /api/quotes/refresh
// Body: { symbols: ["AAPL", "TSLA"] }  — or omit to refresh all tracked symbols
router.post("/quotes/refresh", (req, res) => {
  const body = (req.body ?? {}) as { symbols?: unknown };
  let requested: string[];

  if (body.symbols !== undefined) {
    if (!Array.isArray(body.symbols) || body.symbols.some((s) => typeof s !== "string")) {
      res.status(400).json({
        success: false,
        error: '"symbols" must be an array of strings',
        example: { symbols: ["AAPL", "TSLA", "NVDA"] },
      });
      return;
    }
    requested = (body.symbols as string[]).map((s) => s.toUpperCase().trim()).filter(Boolean);
  } else {
    // No body — refresh everything
    requested = Object.keys(priceState);
  }

  const found: ReturnType<typeof buildRefreshedQuote>[] = [];
  const notFound: string[] = [];

  for (const sym of requested) {
    const quote = buildRefreshedQuote(sym);
    if (quote) {
      found.push(quote);
    } else {
      notFound.push(sym);
    }
  }

  res.json({
    success: true,
    refreshed: found.length,
    data: found,
    ...(notFound.length > 0 && { not_found: notFound }),
  });
});

export default router;
