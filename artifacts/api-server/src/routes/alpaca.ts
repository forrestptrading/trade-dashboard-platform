import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  AlpacaMarketDataError,
  getAlpacaConfigCheck,
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

export default router;
