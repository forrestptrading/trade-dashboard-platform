import { Router, type IRouter } from "express";
import { getBroker, getDefaultBroker, type BrokerClient } from "../broker/index.js";
import { getPortfolioSnapshot } from "../services/portfolioData.js";
import { computeRiskReport } from "../services/riskService.js";
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
 * GET /api/risk
 * Risk Engine. Computes concentration, cash exposure, estimated beta
 * (placeholder), max drawdown (placeholder) and an overall risk score.
 */
router.get("/risk", async (req, res) => {
  try {
    const broker = resolveBroker(req.query["broker"]);
    const snapshot = await getPortfolioSnapshot(broker);
    const risk = computeRiskReport(snapshot);
    res.json({ success: true, source: snapshot.source, data: risk });
  } catch (err) {
    logger.error(
      `[risk] failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to compute risk" });
  }
});

export default router;
