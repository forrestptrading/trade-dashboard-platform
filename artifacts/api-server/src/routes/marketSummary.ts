import { Router, type IRouter } from "express";

const router: IRouter = Router();

// TODO: Robinhood integration
// Indices: GET https://api.robinhood.com/marketdata/quotes/?symbols=SPY,QQQ,DIA
// Market hours: GET https://api.robinhood.com/markets/XNAS/hours/<date>/
// Sectors: No native Robinhood endpoint — supplement with Alpha Vantage or Polygon.io
// Requires: Authorization: Bearer <access_token>

function getMarketStatus(): {
  status: "open" | "closed" | "pre-market" | "after-hours";
  message: string;
  nextEvent: string;
} {
  const now = new Date();
  // Use Eastern Time offset (UTC-4 during EDT, UTC-5 during EST)
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + 24 + etOffset) % 24;
  const etMinute = now.getUTCMinutes();
  const etMinuteOfDay = etHour * 60 + etMinute;
  const day = now.getUTCDay(); // 0=Sun, 6=Sat

  if (day === 0 || day === 6) {
    return {
      status: "closed",
      message: "Markets closed — weekend",
      nextEvent: "Pre-market opens Monday 4:00 AM ET",
    };
  }

  if (etMinuteOfDay < 240) {
    // Before 4:00 AM
    return {
      status: "closed",
      message: "Markets closed",
      nextEvent: `Pre-market opens at 4:00 AM ET`,
    };
  } else if (etMinuteOfDay < 570) {
    // 4:00 AM – 9:30 AM
    return {
      status: "pre-market",
      message: "Pre-market trading in session",
      nextEvent: `Regular session opens at 9:30 AM ET`,
    };
  } else if (etMinuteOfDay < 960) {
    // 9:30 AM – 4:00 PM
    return {
      status: "open",
      message: "Markets open",
      nextEvent: `Regular session closes at 4:00 PM ET`,
    };
  } else if (etMinuteOfDay < 1200) {
    // 4:00 PM – 8:00 PM
    return {
      status: "after-hours",
      message: "After-hours trading in session",
      nextEvent: `After-hours closes at 8:00 PM ET`,
    };
  } else {
    return {
      status: "closed",
      message: "Markets closed",
      nextEvent: `Pre-market opens tomorrow at 4:00 AM ET`,
    };
  }
}

function isDST(date: Date): boolean {
  // DST in the US: second Sunday in March through first Sunday in November
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

router.get("/market/summary", (_req, res) => {
  const marketStatus = getMarketStatus();

  const indices = [
    {
      symbol: "SPY",
      name: "S&P 500",
      price: 512.87,
      change: 2.34,
      changePercent: 0.46,
      ytdChangePercent: 11.23,
    },
    {
      symbol: "QQQ",
      name: "Nasdaq 100",
      price: 436.19,
      change: 3.45,
      changePercent: 0.8,
      ytdChangePercent: 14.87,
    },
    {
      symbol: "DIA",
      name: "Dow Jones",
      price: 388.41,
      change: -0.87,
      changePercent: -0.22,
      ytdChangePercent: 5.91,
    },
    {
      symbol: "IWM",
      name: "Russell 2000",
      price: 208.63,
      change: 1.12,
      changePercent: 0.54,
      ytdChangePercent: 3.44,
    },
    {
      symbol: "VIX",
      name: "CBOE Volatility",
      price: 13.82,
      change: -0.41,
      changePercent: -2.88,
      ytdChangePercent: null,
    },
  ];

  const sectors = [
    { name: "Technology", etf: "XLK", changePercent: 1.42, trend: "up" },
    { name: "Consumer Discretionary", etf: "XLY", changePercent: 0.87, trend: "up" },
    { name: "Communication Services", etf: "XLC", changePercent: 0.63, trend: "up" },
    { name: "Industrials", etf: "XLI", changePercent: 0.21, trend: "up" },
    { name: "Financials", etf: "XLF", changePercent: 0.04, trend: "up" },
    { name: "Health Care", etf: "XLV", changePercent: -0.18, trend: "down" },
    { name: "Real Estate", etf: "XLRE", changePercent: -0.34, trend: "down" },
    { name: "Utilities", etf: "XLU", changePercent: -0.52, trend: "down" },
    { name: "Materials", etf: "XLB", changePercent: -0.61, trend: "down" },
    { name: "Consumer Staples", etf: "XLP", changePercent: -0.74, trend: "down" },
    { name: "Energy", etf: "XLE", changePercent: -1.08, trend: "down" },
  ];

  const movers = {
    gainers: [
      { symbol: "NVDA", changePercent: 2.63 },
      { symbol: "AMD", changePercent: 3.01 },
      { symbol: "META", changePercent: 1.75 },
    ],
    losers: [
      { symbol: "TSLA", changePercent: -2.15 },
      { symbol: "GOOGL", changePercent: -0.68 },
      { symbol: "DIS", changePercent: -0.89 },
    ],
  };

  res.json({
    success: true,
    data: {
      market: marketStatus,
      indices,
      sectors,
      movers,
      timestamp: new Date().toISOString(),
      _robinhood_note:
        "Future: indices from quotes/?symbols=SPY,QQQ,DIA,IWM; market hours from markets/XNAS/hours/<date>/; sectors from third-party (Polygon.io or Alpha Vantage)",
    },
  });
});

export default router;
