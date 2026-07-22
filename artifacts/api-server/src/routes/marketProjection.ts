import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";
import { getLastEnrichedScan } from "../lib/marketScanLive.js";
import { computeMarketProjection } from "../lib/marketProjection.js";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

function ownerEmail(): string {
  return process.env["DASHBOARD_OWNER_EMAIL"]?.trim().toLowerCase() ?? "";
}

/**
 * POST /api/market-projection
 *
 * Owner-only. Computes trend-news analogue projections for the top five
 * candidates of the server's most recent enriched market scan. Never trusts
 * candidate data, prices, or news supplied by the browser. Results are cached
 * for 15 minutes; an authenticated force_refresh=true bypasses the cache.
 */
router.post("/market-projection", requireAuth, async (req, res) => {
  const owner = ownerEmail();
  if (!owner) {
    res.status(503).json({ success: false, error: "DASHBOARD_OWNER_EMAIL is not configured" });
    return;
  }
  if (req.user?.email.toLowerCase() !== owner) {
    res.status(403).json({ success: false, error: "Dashboard owner access required" });
    return;
  }
  const apiKey = process.env["MASSIVE_API_KEY"]?.trim() ?? "";
  if (!apiKey) {
    res.status(503).json({ success: false, error: "MASSIVE_API_KEY is not configured" });
    return;
  }

  const scan = getLastEnrichedScan();
  if (!scan || !scan.candidates.length) {
    res.status(409).json({
      success: false,
      error: "No enriched market scan is cached on the server. Run the full-market scan first.",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const forceRefresh = body["force_refresh"] === true;

  try {
    const result = await computeMarketProjection(scan, apiKey, forceRefresh);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[market-projection] projection failed");
    res.status(502).json({
      success: false,
      error: "Market projection is temporarily unavailable",
      detail: message.slice(0, 240),
    });
  }
});

export default router;
