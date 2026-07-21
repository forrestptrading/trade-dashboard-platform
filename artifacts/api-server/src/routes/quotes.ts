import { Router, type IRouter } from "express";
import { getBroker } from "../broker/index.js";
import { logger } from "../lib/logger.js";
import {
  enrichMarketScan,
  liveScanConfig,
  type LiveEnrichmentResult,
} from "../lib/marketScanLive.js";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();
const MASSIVE_BASE_URL = "https://api.massive.com";
const MARKET_SCAN_CACHE_MS = 6 * 60 * 60 * 1_000;
const MARKET_SCAN_TIMEOUT_MS = 25_000;
const MARKET_SCAN_MAX_RESULTS = 50;
const MARKET_SCAN_DEFAULT_RESULTS = 20;
const MARKET_SCAN_ANCHOR_OFFSETS = [0, 7, 14, 21, 28] as const;

interface MassiveDailyBar {
  T?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  vw?: unknown;
  n?: unknown;
  t?: unknown;
}

interface NormalizedDailyBar {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  transactions: number | null;
  timestamp: number | null;
}

interface DatedMarketBars {
  requestedDate: string;
  bars: Map<string, NormalizedDailyBar>;
}

interface MarketScanCandidate {
  symbol: string;
  latest_close: number;
  week_return_percent: number;
  month_return_percent: number;
  positive_trend_segments: number;
  total_trend_segments: number;
  average_dollar_volume: number;
  latest_volume: number;
  average_sampled_range_percent: number;
  close_above_sample_average: boolean;
  close_above_latest_vwap: boolean | null;
  confidence_meter: number;
  confidence_label: "strong" | "moderate" | "weak";
  score_breakdown: {
    week_momentum: number;
    month_trend: number;
    trend_consistency: number;
    price_alignment: number;
    liquidity: number;
    controlled_volatility: number;
  };
  sampled_dates: string[];
  data_notes: string[];
}

interface MarketScanPayload {
  generated_at: string;
  data_through: string;
  requested_anchor_dates: string[];
  available_anchor_dates: string[];
  unavailable_anchor_dates: string[];
  universe_scanned: number;
  eligible_after_filters: number;
  confidence_method: string;
  optionability_verified: false;
  candidates: MarketScanCandidate[];
}

let marketScanCache: { expiresAt: number; payload: MarketScanPayload } | null = null;
let activeMarketScan: Promise<MarketScanPayload> | null = null;

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function ownerEmail(): string {
  return process.env["DASHBOARD_OWNER_EMAIL"]?.trim().toLowerCase() ?? "";
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function previousWeekday(date: Date): Date {
  const result = new Date(date.getTime());
  do {
    result.setUTCDate(result.getUTCDate() - 1);
  } while (isWeekend(result));
  return result;
}

function moveBackToWeekday(date: Date): Date {
  const result = new Date(date.getTime());
  while (isWeekend(result)) result.setUTCDate(result.getUTCDate() - 1);
  return result;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function easternDateParts(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values["year"]),
    month: Number(values["month"]),
    day: Number(values["day"]),
    hour: Number(values["hour"]),
  };
}

function latestCompletedSessionDate(now: Date): Date {
  const eastern = easternDateParts(now);
  let date = new Date(Date.UTC(eastern.year, eastern.month - 1, eastern.day));

  // Use today's grouped bar only after the full extended session has ended.
  if (eastern.hour < 20 || isWeekend(date)) date = previousWeekday(date);
  return moveBackToWeekday(date);
}

function marketScanAnchorDates(now: Date): string[] {
  const latest = latestCompletedSessionDate(now);
  const dates = MARKET_SCAN_ANCHOR_OFFSETS.map((offset) => {
    const date = new Date(latest.getTime());
    date.setUTCDate(date.getUTCDate() - offset);
    return isoDate(moveBackToWeekday(date));
  });
  return [...new Set(dates)];
}

function normalizeMassiveBar(value: MassiveDailyBar): NormalizedDailyBar | null {
  const symbol = typeof value.T === "string" ? value.T.trim().toUpperCase() : "";
  const open = optionalNumber(value.o);
  const high = optionalNumber(value.h);
  const low = optionalNumber(value.l);
  const close = optionalNumber(value.c);
  const volume = optionalNumber(value.v);
  if (!symbol || !/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) return null;
  if (open === null || high === null || low === null || close === null || volume === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null;

  return {
    symbol,
    open,
    high,
    low,
    close,
    volume,
    vwap: optionalNumber(value.vw),
    transactions: optionalNumber(value.n),
    timestamp: optionalNumber(value.t),
  };
}

async function fetchMassiveDailyMarket(
  date: string,
  apiKey: string,
): Promise<DatedMarketBars> {
  const url = new URL(
    `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}`,
    MASSIVE_BASE_URL,
  );
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("include_otc", "false");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(MARKET_SCAN_TIMEOUT_MS),
  });

  const payload = await response.json().catch(() => null) as
    | { results?: unknown; error?: unknown; message?: unknown; status?: unknown }
    | null;

  if (!response.ok) {
    const detail = typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.message === "string"
        ? payload.message
        : `HTTP ${response.status}`;
    throw new Error(`Massive market data failed for ${date}: ${detail}`);
  }

  const results = Array.isArray(payload?.results) ? payload.results : [];
  const bars = new Map<string, NormalizedDailyBar>();
  for (const item of results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const bar = normalizeMassiveBar(item as MassiveDailyBar);
    if (bar) bars.set(bar.symbol, bar);
  }

  return { requestedDate: date, bars };
}

function liquidityScore(averageDollarVolume: number): number {
  if (averageDollarVolume >= 500_000_000) return 15;
  if (averageDollarVolume >= 100_000_000) return 13;
  if (averageDollarVolume >= 25_000_000) return 10;
  if (averageDollarVolume >= 10_000_000) return 7;
  if (averageDollarVolume >= 5_000_000) return 5;
  return 0;
}

function volatilityScore(averageRangePercent: number): number {
  if (averageRangePercent <= 3) return 10;
  if (averageRangePercent <= 5) return 8;
  if (averageRangePercent <= 8) return 5;
  if (averageRangePercent <= 12) return 2;
  return 0;
}

function confidenceLabel(score: number): "strong" | "moderate" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 65) return "moderate";
  return "weak";
}

function scoreCandidate(
  symbol: string,
  datedBars: Array<{ date: string; bar: NormalizedDailyBar }>,
): MarketScanCandidate | null {
  const newestFirst = [...datedBars].sort((a, b) => b.date.localeCompare(a.date));
  const latest = newestFirst[0];
  const weekReference = newestFirst[1];
  const monthReference = newestFirst.at(-1);
  if (!latest || !weekReference || !monthReference || newestFirst.length < 3) return null;

  const weekReturn = percentChange(latest.bar.close, weekReference.bar.close);
  const monthReturn = percentChange(latest.bar.close, monthReference.bar.close);
  if (weekReturn === null || monthReturn === null) return null;

  const chronological = [...newestFirst].reverse();
  let positiveSegments = 0;
  let totalSegments = 0;
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1];
    const current = chronological[index];
    if (!previous || !current) continue;
    totalSegments += 1;
    if (current.bar.close > previous.bar.close) positiveSegments += 1;
  }
  if (!totalSegments) return null;

  const averageDollarVolume = chronological.reduce(
    (sum, item) => sum + item.bar.close * item.bar.volume,
    0,
  ) / chronological.length;
  const averageRangePercent = chronological.reduce((sum, item) => {
    const rangePercent = item.bar.close > 0
      ? ((item.bar.high - item.bar.low) / item.bar.close) * 100
      : 100;
    return sum + rangePercent;
  }, 0) / chronological.length;
  const sampleAverage = chronological.reduce((sum, item) => sum + item.bar.close, 0)
    / chronological.length;
  const closeAboveSampleAverage = latest.bar.close > sampleAverage;
  const closeAboveLatestVwap = latest.bar.vwap === null
    ? null
    : latest.bar.close >= latest.bar.vwap;

  // Liquidity and stability filters are intentionally strict because the result is
  // intended for options research, where thin underlyings usually produce worse chains.
  if (latest.bar.close < 5 || latest.bar.close > 1_500) return null;
  if (latest.bar.volume < 100_000 || averageDollarVolume < 5_000_000) return null;
  if (weekReturn <= 0 || monthReturn <= 0) return null;
  if (monthReturn > 100 || averageRangePercent > 15) return null;
  if (positiveSegments / totalSegments < 0.5) return null;

  const scoreBreakdown = {
    week_momentum: round(clamp((weekReturn / 8) * 20, 0, 20), 1),
    month_trend: round(clamp((monthReturn / 20) * 25, 0, 25), 1),
    trend_consistency: round((positiveSegments / totalSegments) * 20, 1),
    price_alignment: (closeAboveSampleAverage ? 6 : 0) + (closeAboveLatestVwap === true ? 4 : 0),
    liquidity: liquidityScore(averageDollarVolume),
    controlled_volatility: volatilityScore(averageRangePercent),
  };
  const score = Math.round(
    scoreBreakdown.week_momentum
      + scoreBreakdown.month_trend
      + scoreBreakdown.trend_consistency
      + scoreBreakdown.price_alignment
      + scoreBreakdown.liquidity
      + scoreBreakdown.controlled_volatility,
  );

  const notes = [
    "Confidence measures observed trend quality, liquidity, and stability; it is not a probability of profit.",
    "Options availability, contract liquidity, implied volatility, and Greeks are not verified by this scan.",
  ];
  if (closeAboveLatestVwap === null) notes.push("Latest sampled VWAP was unavailable.");

  return {
    symbol,
    latest_close: round(latest.bar.close, 4),
    week_return_percent: round(weekReturn),
    month_return_percent: round(monthReturn),
    positive_trend_segments: positiveSegments,
    total_trend_segments: totalSegments,
    average_dollar_volume: Math.round(averageDollarVolume),
    latest_volume: Math.round(latest.bar.volume),
    average_sampled_range_percent: round(averageRangePercent),
    close_above_sample_average: closeAboveSampleAverage,
    close_above_latest_vwap: closeAboveLatestVwap,
    confidence_meter: score,
    confidence_label: confidenceLabel(score),
    score_breakdown: scoreBreakdown,
    sampled_dates: newestFirst.map((item) => item.date),
    data_notes: notes,
  };
}

async function buildMarketScan(): Promise<MarketScanPayload> {
  const apiKey = process.env["MASSIVE_API_KEY"]?.trim();
  if (!apiKey) throw new Error("MASSIVE_API_KEY is not configured");

  const generatedAt = new Date();
  const anchorDates = marketScanAnchorDates(generatedAt);
  const sessions: DatedMarketBars[] = [];

  // Five sequential full-market requests stay predictable for entry-level API limits.
  for (const date of anchorDates) {
    sessions.push(await fetchMassiveDailyMarket(date, apiKey));
  }

  const availableSessions = sessions.filter((session) => session.bars.size > 0);
  if (availableSessions.length < 3) {
    throw new Error("Fewer than three historical market sessions were available");
  }

  const latestSession = availableSessions[0];
  if (!latestSession) throw new Error("Latest historical market session was unavailable");

  const symbols = [...latestSession.bars.keys()];
  const candidates: MarketScanCandidate[] = [];
  for (const symbol of symbols) {
    const datedBars = availableSessions
      .map((session) => {
        const bar = session.bars.get(symbol);
        return bar ? { date: session.requestedDate, bar } : null;
      })
      .filter((item): item is { date: string; bar: NormalizedDailyBar } => Boolean(item));
    const candidate = scoreCandidate(symbol, datedBars);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    if (b.confidence_meter !== a.confidence_meter) {
      return b.confidence_meter - a.confidence_meter;
    }
    return b.average_dollar_volume - a.average_dollar_volume;
  });

  return {
    generated_at: generatedAt.toISOString(),
    data_through: latestSession.requestedDate,
    requested_anchor_dates: anchorDates,
    available_anchor_dates: availableSessions.map((session) => session.requestedDate),
    unavailable_anchor_dates: sessions
      .filter((session) => session.bars.size === 0)
      .map((session) => session.requestedDate),
    universe_scanned: symbols.length,
    eligible_after_filters: candidates.length,
    confidence_method:
      "Deterministic 100-point score using one-week momentum, one-month trend, sampled trend consistency, price alignment, dollar-volume liquidity, and controlled volatility.",
    optionability_verified: false,
    candidates,
  };
}

async function getMarketScan(forceRefresh: boolean): Promise<MarketScanPayload> {
  const now = Date.now();
  if (!forceRefresh && marketScanCache && marketScanCache.expiresAt > now) {
    return marketScanCache.payload;
  }
  if (activeMarketScan) return activeMarketScan;

  activeMarketScan = buildMarketScan()
    .then((payload) => {
      marketScanCache = { payload, expiresAt: Date.now() + MARKET_SCAN_CACHE_MS };
      return payload;
    })
    .finally(() => {
      activeMarketScan = null;
    });
  return activeMarketScan;
}

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

router.get("/market-scan", requireAuth, async (req, res) => {
  const owner = ownerEmail();
  if (!owner) {
    res.status(503).json({ success: false, error: "DASHBOARD_OWNER_EMAIL is not configured" });
    return;
  }
  if (req.user?.email.toLowerCase() !== owner) {
    res.status(403).json({ success: false, error: "Dashboard owner access required" });
    return;
  }
  if (!process.env["MASSIVE_API_KEY"]?.trim()) {
    res.status(503).json({ success: false, error: "MASSIVE_API_KEY is not configured" });
    return;
  }

  const requestedLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(requestedLimit)
    ? Math.round(clamp(requestedLimit, 1, MARKET_SCAN_MAX_RESULTS))
    : MARKET_SCAN_DEFAULT_RESULTS;
  const forceRefresh = req.query["refresh"] === "true";

  try {
    // Stage 1 — unchanged historical full-market scan.
    const payload = await getMarketScan(forceRefresh);

    // Stages 2–5 — live snapshot, intraday, news, and options enrichment.
    // Live-stage failures are reported explicitly; they never silently
    // degrade the response back to a historical-only shape.
    const apiKey = process.env["MASSIVE_API_KEY"]?.trim() ?? "";
    const config = liveScanConfig();
    const enrichment: LiveEnrichmentResult = await enrichMarketScan(
      payload.candidates,
      payload.generated_at,
      apiKey,
      forceRefresh,
    );

    const returned = enrichment.candidates.slice(0, limit);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json({
      success: true,
      source: "massive",
      scan_mode: enrichment.scan_mode,
      read_only: true,
      data: {
        ...payload,
        scan_mode: enrichment.scan_mode,
        market_session: enrichment.market_session,
        live_data_as_of: enrichment.live_data_as_of,
        historical_universe_scanned: payload.universe_scanned,
        historical_eligible_count: payload.eligible_after_filters,
        historical_data_through: payload.data_through,
        snapshot_candidates_reviewed: enrichment.snapshot_candidates_reviewed,
        intraday_candidates_reviewed: enrichment.intraday_candidates_reviewed,
        live_eligible_count: enrichment.live_eligible_count,
        news_candidates_reviewed: enrichment.news_candidates_reviewed,
        options_candidates_reviewed: enrichment.options_candidates_reviewed,
        unavailable_capabilities: enrichment.unavailable_capabilities,
        stage_scope: enrichment.stage_scope,
        quote_fallback_used: enrichment.quote_fallback_used,
        option_score_method:
          "Deterministic backend score (0-100) combining option spread quality, open interest, option volume, delta suitability, time to expiration, strike distance from the confirmation level, break-even distance, intraday setup score, and the historical scanner score. The AI does not calculate or alter option scores.",
        returned_candidates: returned.length,
        candidates: returned,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[market-scan] market scan failed");
    res.status(502).json({
      success: false,
      error: "Market scan is temporarily unavailable",
      detail: message.slice(0, 240),
    });
  }
});

export default router;
