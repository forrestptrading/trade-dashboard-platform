import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  AlpacaMarketDataError,
  getAlpacaConfigCheck,
  getLatestAlpacaLiveQuotes,
  getLatestAlpacaStockBar,
} from "../lib/alpacaMarketData.js";

const router: IRouter = Router();

router.get("/alpaca/config-check", (_req, res) => {
  res.json(getAlpacaConfigCheck());
});

router.get("/alpaca/test", requireAuth, async (req, res) => {
  try {
    const data = await getLatestAlpacaStockBar(req.query.symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof AlpacaMarketDataError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: "Alpaca Market Data request failed" });
  }
});

router.get("/alpaca/live", requireAuth, async (req, res) => {
  try {
    const data = await getLatestAlpacaLiveQuotes(req.query.symbols);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json({
      success: true,
      source: "alpaca",
      feed: data[0]?.feed ?? getAlpacaConfigCheck().feed,
      data,
    });
  } catch (error) {
    if (error instanceof AlpacaMarketDataError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: "Alpaca Market Data request failed" });
  }
});

export default router;
