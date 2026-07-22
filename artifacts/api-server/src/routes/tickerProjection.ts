import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";
import { fetchQuoteFallbacks, type QuoteFallback } from "../lib/marketScanLive.js";
import { computeTickerProjection, type ProjectionSubject } from "../lib/marketProjection.js";
import { sanitizeRequestedTickerSymbols } from "../lib/projectionIntent.js";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

function ownerEmail(): string {
  return process.env["DASHBOARD_OWNER_EMAIL"]?.trim().toLowerCase() ?? "";
}

/**
 * POST /api/ticker-projection
 *
 * Owner-only. Computes trend-news analogue projections for 1-5 directly
 * requested tickers. All prices and news are fetched server-side; any
 * client-supplied prices, quotes, or news in the body are ignored. Results
 * are cached for 15 minutes in a cache separate from the scanner projection;
 * force_refresh=true bypasses it.
 */
router.post("/ticker-projection", requireAuth, async (req, res) => {
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const validation = sanitizeRequestedTickerSymbols(body["symbols"]);
  if (!validation.ok) {
    res.status(400).json({ success: false, error: validation.error });
    return;
  }
  const forceRefresh = body["force_refresh"] === true;

  try {
    // Server-side quotes only — client-sent prices are never trusted.
    let quoteMap = new Map<string, QuoteFallback>();
    try {
      quoteMap = await fetchQuoteFallbacks(validation.symbols);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, "[ticker-projection] live quote fetch failed; anchoring to latest completed close");
    }
    const subjects: ProjectionSubject[] = validation.symbols.map((symbol) => ({
      symbol,
      live_quote: quoteMap.get(symbol) ?? null,
      live_snapshot: null,
    }));
    const result = await computeTickerProjection(subjects, apiKey, forceRefresh);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[ticker-projection] projection failed");
    res.status(502).json({
      success: false,
      error: "Ticker projection is temporarily unavailable",
      detail: message.slice(0, 240),
    });
  }
});

export default router;
