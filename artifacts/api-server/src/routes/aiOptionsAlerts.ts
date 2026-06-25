import { Router, type IRouter } from "express";

const router: IRouter = Router();

const MOCK_ALERTS = [
  {
    ticker: "NVDA",
    type: "CALL",
    strike: 150,
    expiration: "2026-07-19",
    confidence: 82,
    reason: "Unusual call activity and strong momentum",
    risk: "High",
  },
  {
    ticker: "SPY",
    type: "CALL",
    strike: 620,
    expiration: "2026-07-19",
    confidence: 74,
    reason: "Index momentum improving with strong volume",
    risk: "Medium",
  },
];

router.get("/ai/options-alerts", (_req, res) => {
  res.json({
    success: true,
    source: "mock",
    alerts: MOCK_ALERTS,
  });
});

export default router;
