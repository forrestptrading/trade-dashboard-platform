import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/alerts", (_req, res) => {
  const alerts = [
    {
      id: "alrt-001",
      severity: "high",
      type: "price_target",
      symbol: "NVDA",
      title: "NVDA approaching 52-week high",
      message:
        "NVDA is trading within 2.8% of its 52-week high of $901.32. Consider reviewing your position size and setting a stop-loss.",
      suggested_action: "review_position",
      created_at: "2026-06-17T11:30:00.000Z",
      read: false,
    },
    {
      id: "alrt-002",
      severity: "medium",
      type: "rebalance",
      symbol: null,
      title: "Portfolio drift detected",
      message:
        "Technology allocation has grown to 38.4% of portfolio, exceeding your 30% target by 8.4 percentage points.",
      suggested_action: "rebalance",
      created_at: "2026-06-17T09:00:00.000Z",
      read: false,
    },
    {
      id: "alrt-003",
      severity: "low",
      type: "earnings",
      symbol: "AAPL",
      title: "AAPL earnings in 4 days",
      message:
        "Apple reports Q3 earnings on June 21. Implied volatility is elevated at 34.2%. Consider hedging or reducing position before the report.",
      suggested_action: "consider_hedge",
      created_at: "2026-06-17T08:00:00.000Z",
      read: true,
    },
    {
      id: "alrt-004",
      severity: "high",
      type: "stop_loss",
      symbol: "TSLA",
      title: "TSLA below moving average",
      message:
        "TSLA has crossed below its 50-day moving average ($248.30) on above-average volume. Momentum signal has turned bearish.",
      suggested_action: "review_stop_loss",
      created_at: "2026-06-16T15:45:00.000Z",
      read: false,
    },
    {
      id: "alrt-005",
      severity: "low",
      type: "dividend",
      symbol: "MSFT",
      title: "Dividend payment received",
      message: "MSFT dividend of $15.00 was credited to your account.",
      suggested_action: null,
      created_at: "2026-06-05T09:00:00.000Z",
      read: true,
    },
  ];

  const unread = alerts.filter((a) => !a.read).length;

  res.json({
    success: true,
    count: alerts.length,
    unread,
    data: alerts,
  });
});

export default router;
