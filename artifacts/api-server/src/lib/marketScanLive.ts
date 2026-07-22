import { logger } from "./logger.js";
import { getBroker } from "../broker/index.js";

/**
 * Live enrichment pipeline for the full-market scanner (Stage 2+).
 *
 * Stage 1 (historical grouped-daily scan) lives in routes/quotes.ts and is
 * unchanged. This module enriches its top candidates with:
 *   Stage 2 — current stock snapshots        (top 25)
 *   Stage 3 — 5-minute intraday aggregates   (top 10 snapshot-qualified)
 *   Stage 4 — ticker news                    (final 5)
 *   Stage 5 — options-chain snapshots        (final 2)
 *
 * Every number returned here is fetched or deterministically derived from
 * Massive responses. Missing live data is reported as explicitly unavailable —
 * it is never silently replaced with historical values.
 */

const MASSIVE_BASE_URL = "https://api.massive.com";
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Configurable thresholds (env-overridable, deterministic defaults)
// ---------------------------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function liveScanConfig() {
  return {
    snapshotCandidates: 25,
    intradayCandidates: 10,
    newsCandidates: 5,
    optionsCandidates: 2,
    maxContractsPerCandidate: 3,
    liveCacheMs: envNumber("MARKET_SCAN_LIVE_CACHE_MS", 90_000),
    optionsDteMin: envNumber("MARKET_SCAN_OPT_DTE_MIN", 7),
    optionsDteMax: envNumber("MARKET_SCAN_OPT_DTE_MAX", 45),
    optionsStrikeBandPercent: envNumber("MARKET_SCAN_OPT_STRIKE_BAND_PCT", 10),
    optionsMaxSpreadPercent: envNumber("MARKET_SCAN_OPT_MAX_SPREAD_PCT", 8),
    optionsMinOpenInterest: envNumber("MARKET_SCAN_OPT_MIN_OI", 250),
    optionsMinVolume: envNumber("MARKET_SCAN_OPT_MIN_VOLUME", 25),
    optionsQuoteMaxAgeSeconds: envNumber("MARKET_SCAN_OPT_QUOTE_MAX_AGE_S", 900),
    optionsPageLimit: 250,
    optionsMaxPages: 2,
    newsCatalystMaxAgeHours: envNumber("MARKET_SCAN_NEWS_CATALYST_MAX_AGE_H", 36),
  };
}

export type LiveScanConfig = ReturnType<typeof liveScanConfig>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Massive timestamps arrive in ns, µs, or ms depending on the endpoint. */
function normalizeEpochMs(value: unknown): number | null {
  const raw = optionalNumber(value);
  if (raw === null || raw <= 0) return null;
  if (raw > 1e17) return Math.round(raw / 1e6); // ns
  if (raw > 1e14) return Math.round(raw / 1e3); // µs
  return Math.round(raw); // ms
}

function isoOrNull(epochMs: number | null): string | null {
  return epochMs !== null ? new Date(epochMs).toISOString() : null;
}

export type MarketSession = "pre-market" | "regular" | "after-hours" | "closed" | "unknown";

interface EasternClock {
  session: MarketSession;
  dateIso: string;
  minuteOfDay: number;
}

export function easternClock(now: Date): EasternClock {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const minuteOfDay = Number(values["hour"]) * 60 + Number(values["minute"]);
    const weekend = ["Sat", "Sun"].includes(values["weekday"] ?? "");
    let session: MarketSession = "closed";
    if (!weekend) {
      if (minuteOfDay >= 240 && minuteOfDay < 570) session = "pre-market";
      else if (minuteOfDay >= 570 && minuteOfDay < 960) session = "regular";
      else if (minuteOfDay >= 960 && minuteOfDay < 1_200) session = "after-hours";
    }
    return {
      session,
      dateIso: `${values["year"]}-${values["month"]}-${values["day"]}`,
      minuteOfDay,
    };
  } catch {
    return { session: "unknown", dateIso: now.toISOString().slice(0, 10), minuteOfDay: 0 };
  }
}

// ---------------------------------------------------------------------------
// Massive fetch with plan-restriction detection
// ---------------------------------------------------------------------------

export interface CapabilityFailure {
  capability: string;
  reason: string;
  plan_restricted: boolean;
}

export class MassiveRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly planRestricted: boolean,
  ) {
    super(message);
  }
}

export async function massiveGet(path: string, params: Record<string, string>, apiKey: string): Promise<JsonObject> {
  const url = path.startsWith("https://")
    ? new URL(path)
    : new URL(path, MASSIVE_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = asRecord(await response.json().catch(() => null));

  if (!response.ok) {
    const detail =
      (typeof payload["error"] === "string" && payload["error"]) ||
      (typeof payload["message"] === "string" && payload["message"]) ||
      `HTTP ${response.status}`;
    const planRestricted =
      response.status === 403 ||
      /not authorized|not entitled|upgrade your plan|plan doesn'?t include|NOT_AUTHORIZED/i.test(detail);
    throw new MassiveRequestError(detail, response.status, planRestricted);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Stage 2 — current stock snapshot
// ---------------------------------------------------------------------------

export interface LiveSnapshot {
  current_price: number | null;
  previous_close: number | null;
  day_open: number | null;
  day_high: number | null;
  day_low: number | null;
  current_volume: number | null;
  previous_day_volume: number | null;
  todays_change_percent: number | null;
  latest_minute_bar: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    timestamp: string | null;
  } | null;
  latest_trade: { price: number | null; timestamp: string | null } | null;
  latest_quote: {
    bid: number | null;
    ask: number | null;
    timestamp: string | null;
  } | null;
  data_timestamp: string | null;
  delayed: boolean;
  unavailable_fields: string[];
}

async function fetchStockSnapshot(symbol: string, apiKey: string): Promise<LiveSnapshot> {
  const payload = await massiveGet(
    `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`,
    {},
    apiKey,
  );
  const ticker = asRecord(payload["ticker"]);
  const day = asRecord(ticker["day"]);
  const prevDay = asRecord(ticker["prevDay"]);
  const minute = asRecord(ticker["min"]);
  const lastTrade = asRecord(ticker["lastTrade"]);
  const lastQuote = asRecord(ticker["lastQuote"]);
  const delayed = String(payload["status"] ?? "").toUpperCase() === "DELAYED";

  const minuteBarTs = normalizeEpochMs(minute["t"]);
  const tradeTs = normalizeEpochMs(lastTrade["t"]);
  const quoteTs = normalizeEpochMs(lastQuote["t"]);
  const updatedTs = normalizeEpochMs(ticker["updated"]);

  const tradePrice = optionalNumber(lastTrade["p"]);
  const minuteClose = optionalNumber(minute["c"]);
  const dayClose = optionalNumber(day["c"]);
  const currentPrice = tradePrice ?? minuteClose ?? dayClose;

  const bid = optionalNumber(lastQuote["p"]);
  const ask = optionalNumber(lastQuote["P"]);
  const hasQuote = bid !== null || ask !== null;

  const unavailable: string[] = [];
  if (currentPrice === null) unavailable.push("current_price");
  if (optionalNumber(prevDay["c"]) === null) unavailable.push("previous_close");
  if (optionalNumber(day["v"]) === null) unavailable.push("current_volume");
  if (minuteClose === null) unavailable.push("latest_minute_bar");
  if (tradePrice === null) unavailable.push("latest_trade");
  if (!hasQuote) unavailable.push("latest_quote");

  return {
    current_price: currentPrice,
    previous_close: optionalNumber(prevDay["c"]),
    day_open: optionalNumber(day["o"]),
    day_high: optionalNumber(day["h"]),
    day_low: optionalNumber(day["l"]),
    current_volume: optionalNumber(day["v"]),
    previous_day_volume: optionalNumber(prevDay["v"]),
    todays_change_percent: optionalNumber(ticker["todaysChangePerc"]),
    latest_minute_bar: minuteClose !== null
      ? {
          open: optionalNumber(minute["o"]),
          high: optionalNumber(minute["h"]),
          low: optionalNumber(minute["l"]),
          close: minuteClose,
          volume: optionalNumber(minute["v"]),
          timestamp: isoOrNull(minuteBarTs),
        }
      : null,
    latest_trade: tradePrice !== null
      ? { price: tradePrice, timestamp: isoOrNull(tradeTs) }
      : null,
    latest_quote: hasQuote ? { bid, ask, timestamp: isoOrNull(quoteTs) } : null,
    data_timestamp: isoOrNull(updatedTs ?? tradeTs ?? minuteBarTs),
    delayed,
    unavailable_fields: unavailable,
  };
}

/**
 * Fetch live quotes for a batch of symbols through the dashboard's existing
 * Robinhood quote provider. Used only when Massive stock snapshots are
 * plan-restricted; provenance is explicitly labeled on every object.
 */
export async function fetchQuoteFallbacks(symbols: string[]): Promise<Map<string, QuoteFallback>> {
  const map = new Map<string, QuoteFallback>();
  if (!symbols.length) return map;
  const broker = getBroker("robinhood");
  const quotes = await broker.getQuotes(symbols);
  for (const quote of quotes) {
    if (!quote || typeof quote.symbol !== "string") continue;
    const price = optionalNumber(quote.last_trade_price);
    const prevClose = optionalNumber(quote.previous_close);
    const bid = optionalNumber(quote.bid_price);
    const ask = optionalNumber(quote.ask_price);
    const spread = bid !== null && ask !== null && ask > 0 ? round(ask - bid, 4) : null;
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    const change = price !== null && prevClose !== null ? round(price - prevClose, 4) : null;
    map.set(quote.symbol.toUpperCase(), {
      source: "robinhood_quote_fallback",
      current_price: price,
      previous_close: prevClose,
      todays_change: change,
      todays_change_percent:
        change !== null && prevClose !== null && prevClose !== 0
          ? round((change / prevClose) * 100, 2)
          : null,
      bid,
      ask,
      spread_amount: spread,
      spread_percent: spread !== null && mid !== null && mid > 0 ? round((spread / mid) * 100, 2) : null,
      data_timestamp: typeof quote.updated_at === "string" && quote.updated_at ? quote.updated_at : null,
      volume: null,
      delayed: false,
      trading_halted: Boolean(quote.trading_halted),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Stage 3 — intraday 5-minute technicals
// ---------------------------------------------------------------------------

interface IntradayBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestampMs: number;
}

export interface IntradayTechnicals {
  session_date: string | null;
  candles_analyzed: number;
  last_candle_close: number | null;
  session_vwap: number | null;
  vwap_distance_percent: number | null;
  vwap_status: "holding-above" | "reclaim" | "rejection" | "below-vwap" | "unavailable";
  opening_range_high: number | null;
  opening_range_low: number | null;
  session_high: number | null;
  session_low: number | null;
  recent_swing_high: number | null;
  recent_swing_low: number | null;
  momentum_5m_percent: number | null;
  momentum_15m_percent: number | null;
  volume_expansion_ratio: number | null;
  range_status: "breakout" | "breakdown" | "inside-range" | "unavailable";
  direction: "bullish" | "bearish" | "neutral";
  confirmation_level: number | null;
  invalidation_level: number | null;
  target_1: number | null;
  target_2: number | null;
  underlying_risk_reward: number | null;
  intraday_setup_score: number;
  data_notes: string[];
}

function easternMinuteOfDay(epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values["hour"]) * 60 + Number(values["minute"]);
}

function previousWeekdayIso(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while ([0, 6].includes(date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}

async function fetchIntradayBars(
  symbol: string,
  sessionDate: string,
  apiKey: string,
): Promise<IntradayBar[]> {
  const payload = await massiveGet(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/5/minute/${sessionDate}/${sessionDate}`,
    { adjusted: "true", sort: "asc", limit: "500" },
    apiKey,
  );
  const bars: IntradayBar[] = [];
  for (const item of asArray(payload["results"])) {
    const bar = asRecord(item);
    const open = optionalNumber(bar["o"]);
    const high = optionalNumber(bar["h"]);
    const low = optionalNumber(bar["l"]);
    const close = optionalNumber(bar["c"]);
    const volume = optionalNumber(bar["v"]);
    const timestampMs = normalizeEpochMs(bar["t"]);
    if (
      open === null || high === null || low === null || close === null ||
      volume === null || timestampMs === null || volume < 0 ||
      open <= 0 || high <= 0 || low <= 0 || close <= 0
    ) continue;
    // Regular session bars only (09:30–16:00 ET, bar start time).
    const minute = easternMinuteOfDay(timestampMs);
    if (minute < 570 || minute >= 960) continue;
    bars.push({ open, high, low, close, volume, timestampMs });
  }
  bars.sort((a, b) => a.timestampMs - b.timestampMs);
  return bars;
}

function computeIntradayTechnicals(
  bars: IntradayBar[],
  currentPrice: number | null,
): IntradayTechnicals {
  const notes: string[] = [];
  const base: IntradayTechnicals = {
    session_date: null,
    candles_analyzed: bars.length,
    last_candle_close: bars.length ? round(bars[bars.length - 1]!.close, 4) : null,
    session_vwap: null,
    vwap_distance_percent: null,
    vwap_status: "unavailable",
    opening_range_high: null,
    opening_range_low: null,
    session_high: null,
    session_low: null,
    recent_swing_high: null,
    recent_swing_low: null,
    momentum_5m_percent: null,
    momentum_15m_percent: null,
    volume_expansion_ratio: null,
    range_status: "unavailable",
    direction: "neutral",
    confirmation_level: null,
    invalidation_level: null,
    target_1: null,
    target_2: null,
    underlying_risk_reward: null,
    intraday_setup_score: 0,
    data_notes: notes,
  };

  if (bars.length < 3) {
    notes.push(
      `Only ${bars.length} regular-session 5-minute candle(s) available; intraday levels were not calculated.`,
    );
    return base;
  }

  // Session VWAP from typical price.
  let cumTpv = 0;
  let cumVolume = 0;
  for (const bar of bars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumTpv += typical * bar.volume;
    cumVolume += bar.volume;
  }
  const vwap = cumVolume > 0 ? cumTpv / cumVolume : null;
  const price = currentPrice ?? bars[bars.length - 1]!.close;

  base.session_vwap = vwap !== null ? round(vwap, 4) : null;
  base.vwap_distance_percent = vwap !== null && vwap > 0
    ? round(((price - vwap) / vwap) * 100, 2)
    : null;

  // Opening range: first 30 minutes (first six 5-minute candles).
  const openingBars = bars.filter(
    (bar) => easternMinuteOfDay(bar.timestampMs) < 600,
  );
  const openingRangeComplete = openingBars.length >= 6 || bars.length > openingBars.length;
  if (openingBars.length) {
    base.opening_range_high = round(Math.max(...openingBars.map((b) => b.high)), 4);
    base.opening_range_low = round(Math.min(...openingBars.map((b) => b.low)), 4);
    if (!openingRangeComplete) {
      notes.push("Opening range is still forming (fewer than 30 minutes of candles).");
    }
  } else {
    notes.push("No opening-range candles (09:30–10:00 ET) were available.");
  }

  base.session_high = round(Math.max(...bars.map((b) => b.high)), 4);
  base.session_low = round(Math.min(...bars.map((b) => b.low)), 4);

  // Recent swing levels from the last hour of completed candles.
  const swingWindow = bars.slice(-12);
  base.recent_swing_high = round(Math.max(...swingWindow.map((b) => b.high)), 4);
  base.recent_swing_low = round(Math.min(...swingWindow.map((b) => b.low)), 4);

  const last = bars[bars.length - 1]!;
  const prev1 = bars[bars.length - 2] ?? null;
  const prev3 = bars[bars.length - 4] ?? null;
  base.momentum_5m_percent = prev1 && prev1.close > 0
    ? round(((last.close - prev1.close) / prev1.close) * 100, 2)
    : null;
  base.momentum_15m_percent = prev3 && prev3.close > 0
    ? round(((last.close - prev3.close) / prev3.close) * 100, 2)
    : null;
  if (base.momentum_15m_percent === null) {
    notes.push("Fewer than four candles; 15-minute momentum unavailable.");
  }

  // Volume expansion: last candle vs the average of up to ten prior candles.
  const priorBars = bars.slice(Math.max(0, bars.length - 11), bars.length - 1);
  const averagePriorVolume = priorBars.length
    ? priorBars.reduce((sum, bar) => sum + bar.volume, 0) / priorBars.length
    : 0;
  base.volume_expansion_ratio = averagePriorVolume > 0
    ? round(last.volume / averagePriorVolume, 2)
    : null;

  // VWAP status over the last three candle closes.
  if (vwap !== null) {
    const recentCloses = bars.slice(-3).map((bar) => bar.close);
    const aboveCount = recentCloses.filter((close) => close >= vwap).length;
    if (price >= vwap && aboveCount === recentCloses.length) base.vwap_status = "holding-above";
    else if (price >= vwap) base.vwap_status = "reclaim";
    else if (aboveCount > 0) base.vwap_status = "rejection";
    else base.vwap_status = "below-vwap";
  }

  // Breakout / breakdown status vs opening range and swing levels.
  if (base.opening_range_high !== null && base.opening_range_low !== null) {
    if (price > base.opening_range_high && price >= (base.recent_swing_high ?? price)) {
      base.range_status = "breakout";
    } else if (price < base.opening_range_low && price <= (base.recent_swing_low ?? price)) {
      base.range_status = "breakdown";
    } else {
      base.range_status = "inside-range";
    }
  }

  // Direction.
  const bullishEvidence =
    (base.vwap_status === "holding-above" || base.vwap_status === "reclaim" ? 1 : 0) +
    ((base.momentum_15m_percent ?? 0) > 0 ? 1 : 0) +
    (base.range_status === "breakout" ? 1 : 0);
  const bearishEvidence =
    (base.vwap_status === "below-vwap" || base.vwap_status === "rejection" ? 1 : 0) +
    ((base.momentum_15m_percent ?? 0) < 0 ? 1 : 0) +
    (base.range_status === "breakdown" ? 1 : 0);
  if (bullishEvidence >= 2 && bullishEvidence > bearishEvidence) base.direction = "bullish";
  else if (bearishEvidence >= 2 && bearishEvidence > bullishEvidence) base.direction = "bearish";

  // Levels require enough valid candles: a completed opening range plus swing data.
  const enoughForLevels =
    bars.length >= 6 &&
    base.opening_range_high !== null &&
    base.opening_range_low !== null &&
    openingRangeComplete &&
    vwap !== null;

  if (!enoughForLevels) {
    notes.push("Not enough valid candles to establish confirmation, invalidation, or targets.");
    return base;
  }

  if (base.direction === "bullish") {
    const confirmation = Math.max(base.opening_range_high!, base.recent_swing_high!);
    const invalidation = Math.min(base.session_vwap!, base.recent_swing_low!);
    const risk = confirmation - invalidation;
    if (risk > 0) {
      base.confirmation_level = round(confirmation, 4);
      base.invalidation_level = round(invalidation, 4);
      base.target_1 = round(confirmation + risk, 4);
      base.target_2 = round(confirmation + 2 * risk, 4);
      base.underlying_risk_reward = round((base.target_1 - confirmation) / risk, 2);
    } else {
      notes.push("Confirmation and invalidation collapsed to the same level; no valid risk range.");
    }
  } else if (base.direction === "bearish") {
    const confirmation = Math.min(base.opening_range_low!, base.recent_swing_low!);
    const invalidation = Math.max(base.session_vwap!, base.recent_swing_high!);
    const risk = invalidation - confirmation;
    if (risk > 0) {
      base.confirmation_level = round(confirmation, 4);
      base.invalidation_level = round(invalidation, 4);
      base.target_1 = round(confirmation - risk, 4);
      base.target_2 = round(confirmation - 2 * risk, 4);
      base.underlying_risk_reward = round((confirmation - base.target_1) / risk, 2);
    } else {
      notes.push("Confirmation and invalidation collapsed to the same level; no valid risk range.");
    }
  } else {
    notes.push("Neutral intraday direction; confirmation, invalidation, and targets are not set.");
  }

  // Deterministic intraday setup score (0–100).
  let score = 0;
  if (base.vwap_status === "holding-above") score += 25;
  else if (base.vwap_status === "reclaim") score += 18;
  else if (base.vwap_status === "rejection") score += 8;
  if (base.range_status === "breakout" || base.range_status === "breakdown") score += 20;
  else if (base.range_status === "inside-range") score += 8;
  const momentum15 = Math.abs(base.momentum_15m_percent ?? 0);
  score += clamp((momentum15 / 1.5) * 20, 0, 20);
  const expansion = base.volume_expansion_ratio ?? 0;
  if (expansion >= 2) score += 20;
  else if (expansion >= 1.3) score += 14;
  else if (expansion >= 1) score += 8;
  if (base.direction !== "neutral") score += 15;
  base.intraday_setup_score = Math.round(clamp(score, 0, 100));

  return base;
}

// ---------------------------------------------------------------------------
// Stage 4 — ticker news
// ---------------------------------------------------------------------------

export interface NewsEnrichment {
  latest_headline: string | null;
  publisher: string | null;
  published_at: string | null;
  sentiment: string | null;
  catalyst_found: boolean;
  data_notes: string[];
}

async function fetchTickerNews(
  symbol: string,
  apiKey: string,
  config: LiveScanConfig,
): Promise<NewsEnrichment> {
  const payload = await massiveGet(
    "/v2/reference/news",
    { ticker: symbol, order: "desc", sort: "published_utc", limit: "5" },
    apiKey,
  );
  const notes: string[] = [];
  const articles = asArray(payload["results"])
    .map((item) => asRecord(item))
    .filter((article) => {
      const tickers = asArray(article["tickers"]).map((t) => String(t).toUpperCase());
      return tickers.includes(symbol.toUpperCase());
    });

  const latest = articles[0];
  if (!latest) {
    notes.push("No ticker-specific news articles were returned.");
    return {
      latest_headline: null,
      publisher: null,
      published_at: null,
      sentiment: null,
      catalyst_found: false,
      data_notes: notes,
    };
  }

  const publishedAt = typeof latest["published_utc"] === "string" ? latest["published_utc"] : null;
  const publishedMs = publishedAt ? Date.parse(publishedAt) : NaN;
  const ageHours = Number.isFinite(publishedMs)
    ? (Date.now() - publishedMs) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const catalystFound = ageHours <= config.newsCatalystMaxAgeHours;
  if (!catalystFound) {
    notes.push(
      `Latest article is ${Number.isFinite(ageHours) ? Math.round(ageHours) : "unknown"} hours old — not treated as a current catalyst (threshold ${config.newsCatalystMaxAgeHours}h).`,
    );
  }

  let sentiment: string | null = null;
  for (const insightValue of asArray(latest["insights"])) {
    const insight = asRecord(insightValue);
    if (String(insight["ticker"] ?? "").toUpperCase() === symbol.toUpperCase()) {
      sentiment = typeof insight["sentiment"] === "string" ? insight["sentiment"] : null;
      break;
    }
  }
  if (sentiment === null) notes.push("Publisher sentiment was not supplied for this article.");

  const publisher = asRecord(latest["publisher"]);
  return {
    latest_headline: typeof latest["title"] === "string" ? latest["title"].slice(0, 300) : null,
    publisher: typeof publisher["name"] === "string" ? publisher["name"] : null,
    published_at: publishedAt,
    sentiment,
    catalyst_found: catalystFound,
    data_notes: notes,
  };
}

// ---------------------------------------------------------------------------
// Stage 5 — options-chain snapshot
// ---------------------------------------------------------------------------

export interface OptionContract {
  contract_ticker: string;
  strike: number;
  expiration: string;
  contract_type: "call" | "put";
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread_amount: number | null;
  spread_percent: number | null;
  last_trade_price: number | null;
  last_trade_timestamp: string | null;
  volume: number | null;
  open_interest: number | null;
  implied_volatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  break_even_price: number | null;
  underlying_price: number | null;
  quote_timestamp: string | null;
  liquidity_score: number;
  score_components: Record<string, number>;
}

export interface OptionsEnrichment {
  options_chain_available: boolean;
  contracts_reviewed: number;
  contracts_rejected: number;
  rejection_reasons: Record<string, number>;
  contracts: OptionContract[];
  data_notes: string[];
}

interface RawContract {
  contractTicker: string;
  strike: number | null;
  expiration: string | null;
  contractType: string;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  lastTradePrice: number | null;
  lastTradeTs: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  breakEven: number | null;
  underlyingPrice: number | null;
  quoteTs: number | null;
}

function parseOptionResult(item: unknown): RawContract | null {
  const contract = asRecord(item);
  const details = asRecord(contract["details"]);
  const quote = asRecord(contract["last_quote"]);
  const trade = asRecord(contract["last_trade"]);
  const day = asRecord(contract["day"]);
  const greeks = asRecord(contract["greeks"]);
  const underlying = asRecord(contract["underlying_asset"]);

  const contractTicker = typeof details["ticker"] === "string" ? details["ticker"] : "";
  if (!contractTicker) return null;

  const bid = optionalNumber(quote["bid"]);
  const ask = optionalNumber(quote["ask"]);
  const midpoint = optionalNumber(quote["midpoint"]) ??
    (bid !== null && ask !== null ? (bid + ask) / 2 : null);

  return {
    contractTicker,
    strike: optionalNumber(details["strike_price"]),
    expiration: typeof details["expiration_date"] === "string" ? details["expiration_date"] : null,
    contractType: String(details["contract_type"] ?? "").toLowerCase(),
    bid,
    ask,
    midpoint,
    lastTradePrice: optionalNumber(trade["price"]),
    lastTradeTs: normalizeEpochMs(trade["sip_timestamp"]),
    volume: optionalNumber(day["volume"]),
    openInterest: optionalNumber(contract["open_interest"]),
    impliedVolatility: optionalNumber(contract["implied_volatility"]),
    delta: optionalNumber(greeks["delta"]),
    gamma: optionalNumber(greeks["gamma"]),
    theta: optionalNumber(greeks["theta"]),
    vega: optionalNumber(greeks["vega"]),
    breakEven: optionalNumber(contract["break_even_price"]),
    underlyingPrice: optionalNumber(underlying["price"]),
    quoteTs: normalizeEpochMs(quote["last_updated"]),
  };
}

function rejectContract(
  raw: RawContract,
  now: Date,
  session: MarketSession,
  config: LiveScanConfig,
): string | null {
  if (raw.bid === null || raw.ask === null) return "missing_bid_or_ask";
  if (raw.ask <= 0) return "zero_ask";
  if (raw.strike === null || raw.expiration === null) return "missing_market_data";

  const spread = raw.ask - raw.bid;
  const spreadPercent = raw.midpoint && raw.midpoint > 0 ? (spread / raw.midpoint) * 100 : null;
  if (spreadPercent === null || spreadPercent > config.optionsMaxSpreadPercent) {
    return "excessive_spread";
  }

  const openInterest = raw.openInterest ?? 0;
  const volume = raw.volume ?? 0;
  if (openInterest < config.optionsMinOpenInterest && volume < config.optionsMinVolume) {
    return "insufficient_liquidity";
  }

  // Quote staleness is only enforceable during the regular session; outside it
  // every option quote is naturally old and is annotated rather than rejected.
  if (session === "regular" && raw.quoteTs !== null) {
    const ageSeconds = (now.getTime() - raw.quoteTs) / 1_000;
    if (ageSeconds > config.optionsQuoteMaxAgeSeconds) return "stale_quote";
  }
  if (raw.quoteTs === null) return "missing_quote_timestamp";

  const expirationMs = Date.parse(`${raw.expiration}T21:00:00Z`);
  if (!Number.isFinite(expirationMs)) return "missing_market_data";
  const dte = (expirationMs - now.getTime()) / 86_400_000;
  if (dte < config.optionsDteMin || dte > config.optionsDteMax) return "expiration_outside_window";

  return null;
}

/**
 * Deterministic backend contract score. The AI must never calculate or alter
 * this value.
 */
function scoreContract(
  raw: RawContract,
  now: Date,
  intraday: IntradayTechnicals,
  historicalConfidence: number,
  config: LiveScanConfig,
): { score: number; components: Record<string, number> } {
  const spread = (raw.ask ?? 0) - (raw.bid ?? 0);
  const spreadPercent = raw.midpoint && raw.midpoint > 0 ? (spread / raw.midpoint) * 100 : config.optionsMaxSpreadPercent;
  const spreadQuality = clamp(20 * (1 - spreadPercent / config.optionsMaxSpreadPercent), 0, 20);

  const openInterest = raw.openInterest ?? 0;
  const oiScore = clamp((Math.log10(Math.max(openInterest, 1)) / 4) * 15, 0, 15);

  const volume = raw.volume ?? 0;
  const volumeScore = clamp((Math.log10(Math.max(volume, 1)) / 3.5) * 10, 0, 10);

  const absDelta = Math.abs(raw.delta ?? 0);
  const deltaSuitability = raw.delta === null
    ? 0
    : clamp(15 * (1 - Math.abs(absDelta - 0.45) / 0.45), 0, 15);

  const expirationMs = Date.parse(`${raw.expiration}T21:00:00Z`);
  const dte = Number.isFinite(expirationMs) ? (expirationMs - now.getTime()) / 86_400_000 : 0;
  const idealDte = (config.optionsDteMin + config.optionsDteMax) / 2;
  const dteScore = clamp(10 * (1 - Math.abs(dte - idealDte) / idealDte), 0, 10);

  const confirmation = intraday.confirmation_level;
  const strikeDistance = confirmation && raw.strike
    ? Math.abs(raw.strike - confirmation) / confirmation
    : null;
  const confirmationScore = strikeDistance === null
    ? 0
    : clamp(10 * (1 - strikeDistance / 0.1), 0, 10);

  const underlying = raw.underlyingPrice;
  const breakEvenDistance = raw.breakEven && underlying && underlying > 0
    ? Math.abs(raw.breakEven - underlying) / underlying
    : null;
  const breakEvenScore = breakEvenDistance === null
    ? 0
    : clamp(10 * (1 - breakEvenDistance / 0.08), 0, 10);

  const intradayComponent = clamp((intraday.intraday_setup_score / 100) * 5, 0, 5);
  const historicalComponent = clamp((historicalConfidence / 100) * 5, 0, 5);

  const components = {
    spread_quality: round(spreadQuality, 1),
    open_interest: round(oiScore, 1),
    option_volume: round(volumeScore, 1),
    delta_suitability: round(deltaSuitability, 1),
    time_to_expiration: round(dteScore, 1),
    confirmation_distance: round(confirmationScore, 1),
    break_even_distance: round(breakEvenScore, 1),
    intraday_setup: round(intradayComponent, 1),
    historical_scanner: round(historicalComponent, 1),
  };
  const score = round(
    Object.values(components).reduce((sum, value) => sum + value, 0),
    1,
  );
  return { score, components };
}

async function fetchOptionsChain(
  symbol: string,
  direction: "bullish" | "bearish",
  underlyingPrice: number,
  intraday: IntradayTechnicals,
  historicalConfidence: number,
  apiKey: string,
  now: Date,
  session: MarketSession,
  config: LiveScanConfig,
): Promise<OptionsEnrichment> {
  const contractType = direction === "bearish" ? "put" : "call";
  const dteMinDate = new Date(now.getTime() + config.optionsDteMin * 86_400_000)
    .toISOString().slice(0, 10);
  const dteMaxDate = new Date(now.getTime() + config.optionsDteMax * 86_400_000)
    .toISOString().slice(0, 10);
  const band = config.optionsStrikeBandPercent / 100;
  const strikeMin = round(underlyingPrice * (1 - band), 2);
  const strikeMax = round(underlyingPrice * (1 + band), 2);

  const notes: string[] = [];
  const rawContracts: RawContract[] = [];
  let nextUrl: string | null = null;
  let pages = 0;

  do {
    const payload: JsonObject = nextUrl
      ? await massiveGet(nextUrl, {}, apiKey)
      : await massiveGet(
          `/v3/snapshot/options/${encodeURIComponent(symbol)}`,
          {
            contract_type: contractType,
            "expiration_date.gte": dteMinDate,
            "expiration_date.lte": dteMaxDate,
            "strike_price.gte": String(strikeMin),
            "strike_price.lte": String(strikeMax),
            limit: String(config.optionsPageLimit),
            sort: "expiration_date",
            order: "asc",
          },
          apiKey,
        );
    for (const item of asArray(payload["results"])) {
      const parsed = parseOptionResult(item);
      if (parsed && parsed.contractType === contractType) rawContracts.push(parsed);
    }
    nextUrl = typeof payload["next_url"] === "string" ? payload["next_url"] : null;
    pages += 1;
  } while (nextUrl && pages < config.optionsMaxPages);

  if (nextUrl) notes.push("Additional option pages existed beyond the configured pagination limit.");

  const rejectionReasons: Record<string, number> = {};
  const accepted: Array<{ raw: RawContract; score: number; components: Record<string, number> }> = [];
  for (const raw of rawContracts) {
    const rejection = rejectContract(raw, now, session, config);
    if (rejection) {
      rejectionReasons[rejection] = (rejectionReasons[rejection] ?? 0) + 1;
      continue;
    }
    const { score, components } = scoreContract(raw, now, intraday, historicalConfidence, config);
    accepted.push({ raw, score, components });
  }

  accepted.sort((a, b) => b.score - a.score);
  if (session !== "regular") {
    notes.push(`Option quotes were captured outside the regular session (${session}); staleness was annotated rather than enforced.`);
  }
  if (!rawContracts.length) notes.push("The options snapshot returned no contracts for the configured filters.");

  const contracts: OptionContract[] = accepted
    .slice(0, config.maxContractsPerCandidate)
    .map(({ raw, score, components }) => {
      const spread = raw.ask !== null && raw.bid !== null ? round(raw.ask - raw.bid, 4) : null;
      const spreadPercent = spread !== null && raw.midpoint && raw.midpoint > 0
        ? round((spread / raw.midpoint) * 100, 2)
        : null;
      return {
        contract_ticker: raw.contractTicker,
        strike: raw.strike!,
        expiration: raw.expiration!,
        contract_type: contractType,
        bid: raw.bid,
        ask: raw.ask,
        midpoint: raw.midpoint !== null ? round(raw.midpoint, 4) : null,
        spread_amount: spread,
        spread_percent: spreadPercent,
        last_trade_price: raw.lastTradePrice,
        last_trade_timestamp: isoOrNull(raw.lastTradeTs),
        volume: raw.volume,
        open_interest: raw.openInterest,
        implied_volatility: raw.impliedVolatility !== null ? round(raw.impliedVolatility, 4) : null,
        delta: raw.delta !== null ? round(raw.delta, 4) : null,
        gamma: raw.gamma !== null ? round(raw.gamma, 4) : null,
        theta: raw.theta !== null ? round(raw.theta, 4) : null,
        vega: raw.vega !== null ? round(raw.vega, 4) : null,
        break_even_price: raw.breakEven,
        underlying_price: raw.underlyingPrice,
        quote_timestamp: isoOrNull(raw.quoteTs),
        liquidity_score: score,
        score_components: components,
      };
    });

  return {
    options_chain_available: true,
    contracts_reviewed: rawContracts.length,
    contracts_rejected: rawContracts.length - accepted.length,
    rejection_reasons: rejectionReasons,
    contracts,
    data_notes: notes,
  };
}

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

export interface HistoricalCandidateLike {
  symbol: string;
  confidence_meter: number;
}

/**
 * Live quote fetched from the dashboard's existing Robinhood quote provider.
 * Used only as a clearly-labeled fallback when Massive stock snapshots are
 * plan-restricted. Never presented as a Massive snapshot.
 */
export interface QuoteFallback {
  source: "robinhood_quote_fallback";
  current_price: number | null;
  previous_close: number | null;
  todays_change: number | null;
  todays_change_percent: number | null;
  bid: number | null;
  ask: number | null;
  spread_amount: number | null;
  spread_percent: number | null;
  data_timestamp: string | null;
  volume: null;
  delayed: boolean;
  trading_halted: boolean;
}

export type StageStatusLabel =
  | "available"
  | "available_robinhood_fallback"
  | "delayed"
  | "plan_restricted"
  | "request_failed"
  | "skipped"
  | "not_requested";

export interface StageStatus {
  status: StageStatusLabel;
  detail: string | null;
}

export interface EnrichmentStatus {
  live_quote: StageStatus;
  snapshot: StageStatus;
  intraday: StageStatus;
  news: StageStatus;
  options: StageStatus;
}

export interface EnrichedCandidate extends HistoricalCandidateLike {
  live_snapshot: LiveSnapshot | null;
  live_quote: QuoteFallback | null;
  intraday: IntradayTechnicals | null;
  news: NewsEnrichment | null;
  options: OptionsEnrichment | null;
  enrichment_stage: "historical" | "snapshot" | "intraday" | "news" | "options";
  enrichment_status: EnrichmentStatus;
  data_quality_notes: string[];
  unavailable_fields: string[];
}

export interface StageScope {
  snapshot_attempts: number;
  intraday_attempts: number;
  news_attempts: number;
  options_attempts: number;
  description: string;
}

export interface LiveEnrichmentResult {
  scan_mode: "market-wide-live-options-v2";
  snapshot_candidates_reviewed: number;
  intraday_candidates_reviewed: number;
  live_eligible_count: number;
  news_candidates_reviewed: number;
  options_candidates_reviewed: number;
  live_data_as_of: string | null;
  market_session: MarketSession;
  unavailable_capabilities: CapabilityFailure[];
  stage_scope: StageScope;
  quote_fallback_used: boolean;
  candidates: EnrichedCandidate[];
}

let liveCache: { expiresAt: number; historicalKey: string; result: LiveEnrichmentResult } | null = null;
let lastEnrichedResult: LiveEnrichmentResult | null = null;

/** Latest enriched result for server-side consumers (AI assistant context). */
export function getLastEnrichedScan(): LiveEnrichmentResult | null {
  return lastEnrichedResult;
}

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function capabilityFromError(capability: string, error: unknown): CapabilityFailure {
  if (error instanceof MassiveRequestError) {
    return {
      capability,
      reason: error.planRestricted
        ? `Not available on the current Massive plan: ${error.message}`
        : error.message.slice(0, 200),
      plan_restricted: error.planRestricted,
    };
  }
  return {
    capability,
    reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    plan_restricted: false,
  };
}

export async function enrichMarketScan(
  historicalCandidates: HistoricalCandidateLike[],
  historicalGeneratedAt: string,
  apiKey: string,
  forceRefresh: boolean,
): Promise<LiveEnrichmentResult> {
  const config = liveScanConfig();
  const historicalKey = `${historicalGeneratedAt}:${historicalCandidates
    .slice(0, config.snapshotCandidates)
    .map((candidate) => candidate.symbol)
    .join(",")}`;

  if (!forceRefresh && liveCache && liveCache.expiresAt > Date.now() && liveCache.historicalKey === historicalKey) {
    return liveCache.result;
  }

  const now = new Date();
  const clock = easternClock(now);
  const unavailableCapabilities: CapabilityFailure[] = [];

  // Stage 2 — snapshots for the top 25 historical candidates.
  const snapshotTargets = historicalCandidates.slice(0, config.snapshotCandidates);
  const notRequested = (stage: string): StageStatus => ({
    status: "not_requested",
    detail: `Not requested at this ranking stage (${stage}).`,
  });
  const enriched: EnrichedCandidate[] = snapshotTargets.map((candidate) => ({
    ...candidate,
    live_snapshot: null,
    live_quote: null,
    intraday: null,
    news: null,
    options: null,
    enrichment_stage: "historical",
    enrichment_status: {
      live_quote: notRequested("quote fallback runs only when Massive snapshots are restricted"),
      snapshot: notRequested(`snapshots go to the top ${config.snapshotCandidates}`),
      intraday: notRequested(`intraday goes to the top ${config.intradayCandidates}`),
      news: notRequested(`news goes to the final ${config.newsCandidates}`),
      options: notRequested(`options go to the final ${config.optionsCandidates}`),
    },
    data_quality_notes: [],
    unavailable_fields: [],
  }));

  let snapshotCapabilityDown = false;
  const snapshotResults = await Promise.all(
    enriched.map((candidate) => settle(fetchStockSnapshot(candidate.symbol, apiKey))),
  );
  let snapshotPlanRestricted = false;
  snapshotResults.forEach((result, index) => {
    const candidate = enriched[index]!;
    if (result.ok) {
      candidate.live_snapshot = result.value;
      candidate.enrichment_stage = "snapshot";
      candidate.unavailable_fields.push(...result.value.unavailable_fields);
      candidate.enrichment_status.snapshot = result.value.delayed
        ? { status: "delayed", detail: "Massive snapshot data is delayed on the current plan." }
        : { status: "available", detail: null };
      if (result.value.delayed) {
        candidate.data_quality_notes.push("Live snapshot data is delayed on the current Massive plan.");
      }
    } else {
      const failure = capabilityFromError("stock_snapshot", result.error);
      candidate.data_quality_notes.push(`Live snapshot unavailable: ${failure.reason}`);
      candidate.unavailable_fields.push("live_snapshot");
      candidate.enrichment_status.snapshot = failure.plan_restricted
        ? { status: "plan_restricted", detail: failure.reason }
        : { status: "request_failed", detail: failure.reason };
      if (failure.plan_restricted) snapshotPlanRestricted = true;
      if (failure.plan_restricted && !snapshotCapabilityDown) {
        snapshotCapabilityDown = true;
        unavailableCapabilities.push(failure);
      }
    }
  });

  // Robinhood live-quote fallback: only when Massive snapshots are
  // plan-restricted. Provenance is preserved — this is never presented as a
  // Massive snapshot, and it supplies no volume, VWAP, candles, or options.
  let quoteFallbackUsed = false;
  if (snapshotPlanRestricted) {
    const fallbackSymbols = enriched
      .filter((candidate) => candidate.live_snapshot === null)
      .map((candidate) => candidate.symbol);
    const fallbackResult = await settle(fetchQuoteFallbacks(fallbackSymbols));
    if (fallbackResult.ok) {
      for (const candidate of enriched) {
        if (candidate.live_snapshot !== null) continue;
        const quote = fallbackResult.value.get(candidate.symbol.toUpperCase()) ?? null;
        if (quote && quote.current_price !== null) {
          candidate.live_quote = quote;
          quoteFallbackUsed = true;
          candidate.enrichment_status.live_quote = {
            status: "available_robinhood_fallback",
            detail: "Live quote supplied by the Robinhood quote provider because Massive snapshots are plan-restricted. Volume, VWAP, and candles are not part of this quote.",
          };
          candidate.data_quality_notes.push(
            "Live price is from the Robinhood quote fallback, not a Massive snapshot.",
          );
        } else {
          candidate.enrichment_status.live_quote = {
            status: "request_failed",
            detail: "The Robinhood quote fallback returned no usable quote for this symbol.",
          };
        }
      }
    } else {
      const reason = fallbackResult.error instanceof Error
        ? fallbackResult.error.message.slice(0, 200)
        : String(fallbackResult.error).slice(0, 200);
      for (const candidate of enriched) {
        if (candidate.live_snapshot !== null) continue;
        candidate.enrichment_status.live_quote = { status: "request_failed", detail: reason };
      }
      logger.warn({ err: reason }, "[market-scan] robinhood quote fallback failed");
    }
  }
  if (!snapshotCapabilityDown) {
    const allFailed = snapshotResults.length > 0 && snapshotResults.every((result) => !result.ok);
    if (allFailed) {
      unavailableCapabilities.push(capabilityFromError("stock_snapshot", (snapshotResults[0] as { error: unknown }).error));
    }
  }

  // Snapshot-qualified: has a live current price and previous close.
  const snapshotQualified = enriched.filter(
    (candidate) =>
      candidate.live_snapshot?.current_price != null &&
      candidate.live_snapshot.previous_close != null,
  );

  // Stage 3 — intraday technicals for the top 10 snapshot-qualified.
  // When the snapshot capability itself is plan-restricted, the intraday
  // stage still runs against the top historical candidates so that one
  // restricted capability does not silently disable an entitled one.
  const intradayTargets = (snapshotQualified.length ? snapshotQualified : enriched)
    .slice(0, config.intradayCandidates);
  if (!snapshotQualified.length && intradayTargets.length) {
    for (const candidate of intradayTargets) {
      candidate.data_quality_notes.push(
        "Intraday analysis proceeded without live snapshot qualification because snapshots were unavailable.",
      );
    }
  }
  let intradayCapabilityDown = false;
  let sameDayIntradayRestricted: CapabilityFailure | null = null;
  const fallbackSessionDate = previousWeekdayIso(clock.dateIso);
  const intradayResults = await Promise.all(
    intradayTargets.map(async (candidate) => {
      const sameDay = await settle(fetchIntradayBars(candidate.symbol, clock.dateIso, apiKey));
      if (sameDay.ok) return { ...sameDay, sessionDate: clock.dateIso, fallback: false };
      const failure = capabilityFromError("intraday_aggregates_same_day", sameDay.error);
      if (!failure.plan_restricted) return { ...sameDay, sessionDate: clock.dateIso, fallback: false };
      // Same-day candles are plan-restricted; explicitly fall back to the
      // latest completed session and report the restriction.
      if (!sameDayIntradayRestricted) sameDayIntradayRestricted = failure;
      const previous = await settle(fetchIntradayBars(candidate.symbol, fallbackSessionDate, apiKey));
      return { ...previous, sessionDate: fallbackSessionDate, fallback: true };
    }),
  );
  intradayResults.forEach((result, index) => {
    const candidate = intradayTargets[index]!;
    if (result.ok) {
      candidate.intraday = computeIntradayTechnicals(
        result.value,
        candidate.live_snapshot?.current_price ?? candidate.live_quote?.current_price ?? null,
      );
      candidate.intraday.session_date = result.sessionDate;
      candidate.enrichment_stage = "intraday";
      if (result.fallback) {
        candidate.enrichment_status.intraday = {
          status: "plan_restricted",
          detail: `Same-day candles are plan-restricted; technicals use the last completed session (${result.sessionDate}).`,
        };
        candidate.intraday.data_notes.push(
          `Same-day 5-minute candles are not included in the current Massive plan; these technicals use the last completed session (${result.sessionDate}). Levels are reference context, not live intraday state.`,
        );
      } else {
        candidate.enrichment_status.intraday = { status: "available", detail: null };
        if (clock.session !== "regular" && result.value.length) {
          candidate.intraday.data_notes.push(
            `Candles are from the ${result.sessionDate} regular session; the market session is currently ${clock.session}.`,
          );
        }
      }
    } else {
      const failure = capabilityFromError("intraday_aggregates", result.error);
      candidate.data_quality_notes.push(`Intraday aggregates unavailable: ${failure.reason}`);
      candidate.unavailable_fields.push("intraday");
      candidate.enrichment_status.intraday = failure.plan_restricted
        ? { status: "plan_restricted", detail: failure.reason }
        : { status: "request_failed", detail: failure.reason };
      if (failure.plan_restricted && !intradayCapabilityDown) {
        intradayCapabilityDown = true;
        unavailableCapabilities.push(failure);
      }
    }
  });
  if (sameDayIntradayRestricted) {
    unavailableCapabilities.push(sameDayIntradayRestricted);
  }
  const anyDelayedIntraday = intradayResults.some(
    (result, index) =>
      result.ok && !result.fallback && intradayTargets[index]?.live_snapshot?.delayed,
  );
  if (anyDelayedIntraday) {
    unavailableCapabilities.push({
      capability: "intraday_aggregates_realtime",
      reason: "Intraday data is delayed (15-minute delay) on the current Massive plan.",
      plan_restricted: true,
    });
    for (const candidate of intradayTargets) {
      if (candidate.intraday && candidate.live_snapshot?.delayed) {
        candidate.intraday.data_notes.push("Intraday candles are delayed on the current Massive plan.");
      }
    }
  }

  // Live-eligible ranking: candidates with intraday data, ordered by combined
  // deterministic historical + intraday scores.
  const liveEligible = intradayTargets
    .filter((candidate) => candidate.intraday !== null)
    .sort((a, b) => {
      const scoreA = a.confidence_meter + (a.intraday?.intraday_setup_score ?? 0);
      const scoreB = b.confidence_meter + (b.intraday?.intraday_setup_score ?? 0);
      return scoreB - scoreA;
    });

  // Stage 4 — news for the final five. When no candidate cleared the intraday
  // stage, news still runs on the top-ranked remaining candidates so an
  // upstream plan restriction does not disable the entitled news capability.
  const newsTargets = (liveEligible.length ? liveEligible : intradayTargets.length ? intradayTargets : enriched)
    .slice(0, config.newsCandidates);
  let newsCapabilityDown = false;
  const newsResults = await Promise.all(
    newsTargets.map((candidate) => settle(fetchTickerNews(candidate.symbol, apiKey, config))),
  );
  newsResults.forEach((result, index) => {
    const candidate = newsTargets[index]!;
    if (result.ok) {
      candidate.news = result.value;
      candidate.enrichment_stage = "news";
      candidate.enrichment_status.news = { status: "available", detail: null };
    } else {
      const failure = capabilityFromError("ticker_news", result.error);
      candidate.data_quality_notes.push(`News unavailable: ${failure.reason}`);
      candidate.unavailable_fields.push("news");
      candidate.enrichment_status.news = failure.plan_restricted
        ? { status: "plan_restricted", detail: failure.reason }
        : { status: "request_failed", detail: failure.reason };
      if (failure.plan_restricted && !newsCapabilityDown) {
        newsCapabilityDown = true;
        unavailableCapabilities.push(failure);
      }
    }
  });

  // Stage 5 — options chains for the final two.
  const optionsTargets = newsTargets.slice(0, config.optionsCandidates);
  let optionsCapabilityDown = false;
  for (const candidate of optionsTargets) {
    const direction = candidate.intraday?.direction ?? "neutral";
    const underlyingPrice = candidate.live_snapshot?.current_price ??
      candidate.live_quote?.current_price ??
      candidate.intraday?.last_candle_close ?? null;
    if (candidate.live_snapshot?.current_price == null && underlyingPrice != null) {
      candidate.data_quality_notes.push(
        candidate.live_quote?.current_price != null
          ? "Options strike band was centered on the Robinhood fallback quote price because Massive snapshots are unavailable."
          : "Options strike band was centered on the last available 5-minute candle close because no live snapshot price was available.",
      );
    }
    if (direction === "neutral") {
      candidate.options = {
        options_chain_available: true,
        contracts_reviewed: 0,
        contracts_rejected: 0,
        rejection_reasons: {},
        contracts: [],
        data_notes: ["Neutral intraday direction — no directional contract type was selected."],
      };
      candidate.enrichment_status.options = {
        status: "skipped",
        detail: "In options scope, but the intraday direction is neutral — no directional contract type was selected, so the chain was not requested.",
      };
      continue;
    }
    if (underlyingPrice == null) {
      candidate.options = {
        options_chain_available: false,
        contracts_reviewed: 0,
        contracts_rejected: 0,
        rejection_reasons: {},
        contracts: [],
        data_notes: ["No live underlying price; the options chain was not requested."],
      };
      candidate.enrichment_status.options = {
        status: "request_failed",
        detail: "No live underlying price was available to center the strike band, so the chain was not requested.",
      };
      candidate.unavailable_fields.push("options");
      continue;
    }
    const result = await settle(
      fetchOptionsChain(
        candidate.symbol,
        direction,
        underlyingPrice,
        candidate.intraday!,
        candidate.confidence_meter,
        apiKey,
        now,
        clock.session,
        config,
      ),
    );
    if (result.ok) {
      candidate.options = result.value;
      candidate.enrichment_stage = "options";
      candidate.enrichment_status.options = { status: "available", detail: null };
    } else {
      const failure = capabilityFromError("options_chain_snapshot", result.error);
      candidate.enrichment_status.options = failure.plan_restricted
        ? { status: "plan_restricted", detail: failure.reason }
        : { status: "request_failed", detail: failure.reason };
      candidate.options = {
        options_chain_available: false,
        contracts_reviewed: 0,
        contracts_rejected: 0,
        rejection_reasons: {},
        contracts: [],
        data_notes: [
          failure.plan_restricted
            ? `Options snapshots are not included in the current Massive plan: ${failure.reason}`
            : `Options snapshot failed: ${failure.reason}`,
        ],
      };
      candidate.unavailable_fields.push("options");
      if (failure.plan_restricted && !optionsCapabilityDown) {
        optionsCapabilityDown = true;
        unavailableCapabilities.push(failure);
      }
    }
  }

  // Final candidate ordering: live-eligible first (already ranked), then the
  // remaining snapshot candidates in historical order.
  const liveSymbols = new Set(liveEligible.map((candidate) => candidate.symbol));
  const orderedCandidates = [
    ...liveEligible,
    ...enriched.filter((candidate) => !liveSymbols.has(candidate.symbol)),
  ];

  const liveTimestamps = enriched
    .flatMap((candidate) => [
      candidate.live_snapshot?.data_timestamp,
      candidate.live_quote?.data_timestamp,
    ])
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  const result: LiveEnrichmentResult = {
    scan_mode: "market-wide-live-options-v2",
    snapshot_candidates_reviewed: snapshotTargets.length,
    intraday_candidates_reviewed: intradayTargets.length,
    live_eligible_count: liveEligible.length,
    news_candidates_reviewed: newsTargets.length,
    options_candidates_reviewed: optionsTargets.length,
    live_data_as_of: liveTimestamps.length ? new Date(Math.max(...liveTimestamps)).toISOString() : null,
    market_session: clock.session,
    unavailable_capabilities: unavailableCapabilities,
    stage_scope: {
      snapshot_attempts: config.snapshotCandidates,
      intraday_attempts: config.intradayCandidates,
      news_attempts: config.newsCandidates,
      options_attempts: config.optionsCandidates,
      description: `Top ${config.snapshotCandidates} receive snapshot attempts, top ${config.intradayCandidates} receive intraday attempts, top ${config.newsCandidates} receive news, top ${config.optionsCandidates} receive options-chain attempts. Candidates outside a stage's cutoff were not requested at that stage.`,
    },
    quote_fallback_used: quoteFallbackUsed,
    candidates: orderedCandidates,
  };

  liveCache = {
    expiresAt: Date.now() + config.liveCacheMs,
    historicalKey,
    result,
  };
  lastEnrichedResult = result;
  logger.info(
    {
      snapshots: snapshotTargets.length,
      intraday: intradayTargets.length,
      liveEligible: liveEligible.length,
      options: optionsTargets.length,
      unavailable: unavailableCapabilities.map((item) => item.capability),
    },
    "[market-scan] live enrichment complete",
  );
  return result;
}
