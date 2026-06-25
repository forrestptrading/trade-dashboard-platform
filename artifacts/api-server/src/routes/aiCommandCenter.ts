import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/ai/command-center", (_req, res) => {
  res.json({
    success: true,
    source: "mock",
    data: {
      summary: "AI is monitoring options activity, breakouts, earnings, and risk.",
      confidence_score: 78,
      market_bias: "Bullish",
      alerts: [
        {
          category: "Options Alert",
          ticker: "NVDA",
          type: "CALL",
          strike: 150,
          expiration: "2026-07-19",
          confidence: 82,
          risk: "High",
          reason: "Unusual call activity and strong momentum",
        },
        {
          category: "Breakout Watch",
          ticker: "SPY",
          type: "WATCH",
          strike: null,
          expiration: null,
          confidence: 74,
          risk: "Medium",
          reason: "Index momentum improving with strong volume",
        },
        {
          category: "Earnings Watch",
          ticker: "MSFT",
          type: "WATCH",
          strike: null,
          expiration: null,
          confidence: 69,
          risk: "Medium",
          reason: "Earnings setup forming with elevated options interest",
        },
      ],
    },
  });
});

export default router;
