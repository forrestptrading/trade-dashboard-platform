import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/options/positions", (_req, res) => {
  const positions = [
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

  res.json({
    success: true,
    count: positions.length,
    data: positions,
  });
});

export default router;
