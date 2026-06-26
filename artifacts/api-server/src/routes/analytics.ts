import { Router, type IRouter } from "express";
import { getBroker, getDefaultBroker, type BrokerClient } from "../broker/index.js";
import { getPortfolioSnapshot } from "../services/portfolioData.js";
import { computePortfolioAnalytics } from "../services/analyticsService.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function resolveBroker(brokerId: unknown): BrokerClient {
  try {
    return getBroker(typeof brokerId === "string" ? brokerId : undefined);
  } catch {
    return getDefaultBroker();
  }
}

/**
 * GET /api/analytics/portfolio
 * Portfolio Analytics Service. Computes allocation, P/L, concentration and a
 * diversification score from live broker data when available, else mock.
 */
router.get("/analytics/portfolio", async (req, res) => {
  try {
    const broker = resolveBroker(req.query["broker"]);
    const snapshot = await getPortfolioSnapshot(broker);
    const analytics = computePortfolioAnalytics(snapshot);
    res.json({ success: true, source: snapshot.source, data: analytics });
  } catch (err) {
    logger.error(
      `[analytics] failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to compute analytics" });
  }
});

export default router;
