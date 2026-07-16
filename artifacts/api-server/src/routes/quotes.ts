import { Router, type IRouter } from "express";
import { getBroker } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/quotes", async (req, res) => {
  const raw = req.query["symbols"];
  if (!raw || typeof raw !== "string") {
    res.status(400).json({
      success: false,
      error: 'Missing required query parameter "symbols"',
    });
    return;
  }

  const requested = [...new Set(
    raw
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => /^[A-Z0-9.-]{1,12}$/.test(symbol)),
  )];

  if (!requested.length) {
    res.status(400).json({ success: false, error: "No valid symbols provided" });
    return;
  }

  try {
    const broker = getBroker(req.query["broker"] as string | undefined);

    // Robinhood's quote endpoint is available without a private account token.
    // Other registered providers may still require their own authenticated session.
    if (broker.brokerId !== "robinhood" && !broker.isAuthenticated()) {
      res.status(503).json({
        success: false,
        error: "The selected market-data provider is not authenticated",
      });
      return;
    }

    const liveQuotes = await broker.getQuotes(requested);
    const data = liveQuotes
      .map((quote) => {
        const price = Number(quote.last_trade_price);
        const previousClose = Number(quote.previous_close);
        if (!quote.symbol || !Number.isFinite(price)) return null;
        const change = Number.isFinite(previousClose) ? price - previousClose : null;
        return {
          symbol: quote.symbol.toUpperCase(),
          price,
          previousClose: Number.isFinite(previousClose) ? previousClose : null,
          change,
          changePercent:
            change !== null && previousClose !== 0
              ? (change / previousClose) * 100
              : null,
          bidPrice: Number.isFinite(Number(quote.bid_price))
            ? Number(quote.bid_price)
            : null,
          askPrice: Number.isFinite(Number(quote.ask_price))
            ? Number(quote.ask_price)
            : null,
          timestamp: quote.updated_at || null,
        };
      })
      .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote));

    const timestamps = data
      .map((quote) => quote.timestamp)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));
    const dataAsOf = timestamps.length
      ? new Date(Math.min(...timestamps.map((value) => value.getTime()))).toISOString()
      : null;

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      success: true,
      source: broker.brokerId,
      count: data.length,
      data_as_of: dataAsOf,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[quotes] live quote request failed");
    res.status(502).json({
      success: false,
      error: "Live quotes are temporarily unavailable",
    });
  }
});

export default router;
