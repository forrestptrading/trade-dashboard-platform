/**
 * Trend-News Projection V1 ("trend-news-analogue-v1").
 *
 * Generates deterministic, probability-based scenario projections for the top
 * five scanner candidates using historical-analogue matching on completed
 * daily bars, broad-market regime data (SPY/QQQ/IWM), a bounded deterministic
 * news adjustment, and the current Robinhood fallback quote as the price
 * anchor. This is not a price prediction: the output is a set of historical
 * scenario bands (20th / median / 80th percentile) with explicit uncertainty,
 * data-quality notes, and an honest walk-forward backtest.
 */

import {
  massiveGet,
  MassiveRequestError,
  easternClock,
  liveScanConfig,
  type EnrichedCandidate,
  type LiveEnrichmentResult,
  type MarketSession,
} from "./marketScanLive.js";

// ---------------------------------------------------------------------------
// Tunables (deterministic, documented in the response)
// ---------------------------------------------------------------------------

export const PROJECTION_CACHE_SECONDS = 900;
export const MAX_ANALOGUES = 60;
export const MIN_ANALOGUES = 30;
export const ANALOGUE_MIN_SPACING_SESSIONS = 5;
export const HISTORY_CALENDAR_DAYS = 750; // targets ~500 trading sessions
export const MIN_USABLE_SESSIONS = 120; // absolute floor to attempt projection
export const HORIZON_DAYS = { one_day: 1, five_day: 5, twenty_day: 20 } as const;
export const NEWS_ADJUSTMENT_CAP_PP = { one_day: 0.75, five_day: 2.0, twenty_day: 4.0 } as const;
export const QUOTE_FRESH_MINUTES = 20;
export const DIRECTION_UP_RATE_BULL = 0.55;
export const DIRECTION_UP_RATE_BEAR = 0.45;
export const BACKTEST_MIN_SAMPLES = 20;
export const BACKTEST_STEP_SESSIONS = 5;
export const CANDIDATE_FETCH_CONCURRENCY = 3;
export const NEWS_RECENCY_HALF_LIFE_HOURS = 48;

export type HorizonKey = keyof typeof HORIZON_DAYS;
const HORIZON_KEYS: HorizonKey[] = ["one_day", "five_day", "twenty_day"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyBar {
  date: string; // YYYY-MM-DD (Eastern session date)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketRegime {
  benchmark_data_through: string | null;
  spy_five_session_return_percent: number | null;
  spy_twenty_session_return_percent: number | null;
  qqq_five_session_return_percent: number | null;
  qqq_twenty_session_return_percent: number | null;
  iwm_five_session_return_percent: number | null;
  iwm_twenty_session_return_percent: number | null;
  spy_twenty_session_volatility_percent: number | null;
  regime: "risk_on" | "neutral" | "risk_off" | "unavailable";
  regime_rule: string;
}

export interface NewsArticleUsed {
  headline: string;
  publisher: string | null;
  published_at: string | null;
  supplied_sentiment: string | null;
  age_hours: number | null;
  is_current_catalyst: boolean;
}

export interface NewsAnalysis {
  aggregate_news_score: number; // -1..+1
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  unknown_sentiment_count: number;
  coverage_quality: "strong" | "moderate" | "weak" | "unavailable";
  sentiment_agreement: "aligned" | "conflicting" | "none";
  trend_and_market_only: boolean;
  articles_used: NewsArticleUsed[];
  notes: string[];
}

export interface HorizonProjection {
  status: "available" | "unavailable";
  unavailable_reason: string | null;
  analogue_count: number;
  historical_up_rate: number | null; // fraction of analogues that finished higher — NOT probability of profit
  unadjusted_median_return_percent: number | null;
  median_return_percent: number | null; // news-adjusted
  bear_return_percent: number | null; // 20th percentile (news-adjusted)
  bull_return_percent: number | null; // 80th percentile (news-adjusted)
  news_adjustment_percent: number | null;
  news_adjustment_cap_percent: number;
  dispersion_percent: number | null; // 80th − 20th percentile spread
  base_price: number | null;
  bear_price: number | null;
  bull_price: number | null;
}

export interface BacktestHorizonResult {
  status: "available" | "insufficient_history";
  samples: number;
  directional_accuracy: number | null;
  median_absolute_error_percent: number | null;
  mean_absolute_error_percent: number | null;
  interval_coverage: number | null; // fraction of actuals inside 20th–80th band
}

export interface CandidateBacktest {
  method: string;
  one_day: BacktestHorizonResult;
  five_day: BacktestHorizonResult;
  twenty_day: BacktestHorizonResult;
}

export interface ConfidenceComponents {
  analogue_count_points: number;
  analogue_similarity_points: number;
  outcome_dispersion_points: number;
  backtest_points: number;
  news_quality_points: number;
  quote_freshness_points: number;
  data_completeness_points: number;
}

export interface CandidateProjection {
  symbol: string;
  rank: number;
  anchor_price: number | null;
  anchor_price_source:
    | "robinhood_quote_fallback"
    | "massive_snapshot"
    | "latest_completed_close"
    | "unavailable";
  quote_timestamp: string | null;
  projection_status: "available" | "unavailable";
  unavailable_reason: string | null;
  direction_bias: "bullish" | "neutral" | "bearish";
  direction_rule: string;
  projection_confidence_score: number;
  projection_confidence_label: "high" | "moderate" | "low";
  confidence_components: ConfidenceComponents;
  news_analysis: NewsAnalysis | null;
  drivers: string[];
  risks: string[];
  data_quality_notes: string[];
  usable_sessions: number;
  horizons: {
    one_day: HorizonProjection;
    five_day: HorizonProjection;
    twenty_day: HorizonProjection;
  };
  backtest: CandidateBacktest | null;
}

export interface ProjectionResult {
  projection_mode: "trend-news-analogue-v1";
  generated_at: string;
  historical_data_through: string | null;
  market_session: MarketSession;
  market_regime: MarketRegime;
  cache_seconds: number;
  cached: boolean;
  method_notes: string[];
  candidates: CandidateProjection[];
}

// ---------------------------------------------------------------------------
// Small helpers
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

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Linear-interpolated percentile of a sorted ascending array. p in [0,1]. */
export function percentile(sortedValues: number[], p: number): number {
  if (!sortedValues.length) return NaN;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const idx = clamp(p, 0, 1) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! + (sortedValues[hi]! - sortedValues[lo]!) * (idx - lo);
}

function easternDateOfEpochMs(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
  return parts; // en-CA gives YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Historical bars
// ---------------------------------------------------------------------------

function normalizeEpochMsLoose(value: unknown): number | null {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw > 1e17) return Math.round(raw / 1e6);
  if (raw > 1e14) return Math.round(raw / 1e3);
  return Math.round(raw);
}

/**
 * Fetch completed daily bars for a ticker. Bars dated on the current Eastern
 * session date are excluded so unfinished same-day candles are never used.
 */
export async function fetchDailyBars(
  symbol: string,
  apiKey: string,
  now: Date,
): Promise<DailyBar[]> {
  const todayEt = easternClock(now).dateIso;
  const from = new Date(now.getTime() - HISTORY_CALENDAR_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const payload = await massiveGet(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${todayEt}`,
    { adjusted: "true", sort: "asc", limit: "50000" },
    apiKey,
  );
  const bars: DailyBar[] = [];
  for (const item of asArray(payload["results"])) {
    const bar = asRecord(item);
    const epoch = normalizeEpochMsLoose(bar["t"]);
    const open = Number(bar["o"]);
    const high = Number(bar["h"]);
    const low = Number(bar["l"]);
    const close = Number(bar["c"]);
    const volume = Number(bar["v"]);
    if (
      epoch === null ||
      ![open, high, low, close].every((v) => Number.isFinite(v) && v > 0) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }
    const date = easternDateOfEpochMs(epoch);
    if (date >= todayEt) continue; // never use an unfinished same-day candle
    bars.push({ date, open, high, low, close, volume });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

// ---------------------------------------------------------------------------
// Feature vectors (strictly no lookahead)
// ---------------------------------------------------------------------------

export const FEATURE_NAMES = [
  "return_5s",
  "return_20s",
  "slope_20s",
  "consistency_20s",
  "volatility_20s",
  "range_20s",
  "rel_strength_5s_vs_spy",
  "rel_strength_20s_vs_spy",
  "spy_return_5s",
  "spy_return_20s",
  "qqq_return_5s",
  "qqq_return_20s",
  "iwm_return_5s",
  "iwm_return_20s",
  "spy_volatility_20s",
] as const;

export interface AnchorFeatures {
  index: number; // index into the candidate bar series
  date: string;
  vector: number[];
}

export interface BenchmarkSeries {
  spy: DailyBar[];
  qqq: DailyBar[];
  iwm: DailyBar[];
}

function returnOver(closes: number[], endIdx: number, sessions: number): number | null {
  const startIdx = endIdx - sessions;
  if (startIdx < 0) return null;
  const start = closes[startIdx]!;
  const end = closes[endIdx]!;
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

function realizedVolatility(closes: number[], endIdx: number, sessions: number): number | null {
  if (endIdx - sessions < 0) return null;
  const rets: number[] = [];
  for (let i = endIdx - sessions + 1; i <= endIdx; i++) {
    const prev = closes[i - 1]!;
    if (prev <= 0) return null;
    rets.push(((closes[i]! - prev) / prev) * 100);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

function trendSlope(closes: number[], endIdx: number, sessions: number): number | null {
  if (endIdx - sessions + 1 < 0) return null;
  const base = closes[endIdx - sessions + 1]!;
  if (base <= 0) return null;
  // least-squares slope of normalized closes over the window, in % per session
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let k = 0; k < sessions; k++) {
    const y = (closes[endIdx - sessions + 1 + k]! / base - 1) * 100;
    sumX += k;
    sumY += y;
    sumXY += k * y;
    sumXX += k * k;
  }
  const n = sessions;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Build no-lookahead feature vectors for every eligible anchor index of a
 * candidate bar series, aligning benchmark features by session date. Anchors
 * whose date is missing from any benchmark series are skipped and counted.
 */
export function buildAnchorFeatures(
  bars: DailyBar[],
  benchmarks: BenchmarkSeries,
): { anchors: AnchorFeatures[]; misalignedDates: number } {
  const closes = bars.map((b) => b.close);
  const benchIndex = new Map<string, { spy: number; qqq: number; iwm: number }>();
  const spyIdx = new Map(benchmarks.spy.map((b, i) => [b.date, i] as const));
  const qqqIdx = new Map(benchmarks.qqq.map((b, i) => [b.date, i] as const));
  const iwmIdx = new Map(benchmarks.iwm.map((b, i) => [b.date, i] as const));
  for (const [date, i] of spyIdx) {
    const q = qqqIdx.get(date);
    const w = iwmIdx.get(date);
    if (q !== undefined && w !== undefined) benchIndex.set(date, { spy: i, qqq: q, iwm: w });
  }
  const spyCloses = benchmarks.spy.map((b) => b.close);
  const qqqCloses = benchmarks.qqq.map((b) => b.close);
  const iwmCloses = benchmarks.iwm.map((b) => b.close);

  const anchors: AnchorFeatures[] = [];
  let misalignedDates = 0;
  for (let i = 20; i < bars.length; i++) {
    const date = bars[i]!.date;
    const bench = benchIndex.get(date);
    if (!bench || bench.spy < 20 || bench.qqq < 20 || bench.iwm < 20) {
      misalignedDates += 1;
      continue;
    }
    const r5 = returnOver(closes, i, 5);
    const r20 = returnOver(closes, i, 20);
    const slope = trendSlope(closes, i, 20);
    const vol = realizedVolatility(closes, i, 20);
    let upDays = 0;
    let rangeSum = 0;
    for (let k = i - 19; k <= i; k++) {
      if (closes[k]! > closes[k - 1]!) upDays += 1;
      rangeSum += ((bars[k]!.high - bars[k]!.low) / bars[k]!.close) * 100;
    }
    const spy5 = returnOver(spyCloses, bench.spy, 5);
    const spy20 = returnOver(spyCloses, bench.spy, 20);
    const qqq5 = returnOver(qqqCloses, bench.qqq, 5);
    const qqq20 = returnOver(qqqCloses, bench.qqq, 20);
    const iwm5 = returnOver(iwmCloses, bench.iwm, 5);
    const iwm20 = returnOver(iwmCloses, bench.iwm, 20);
    const spyVol = realizedVolatility(spyCloses, bench.spy, 20);
    const values = [r5, r20, slope, vol, spy5, spy20, qqq5, qqq20, iwm5, iwm20, spyVol];
    if (values.some((v) => v === null || !Number.isFinite(v))) continue;
    anchors.push({
      index: i,
      date,
      vector: [
        r5!,
        r20!,
        slope!,
        upDays / 20,
        vol!,
        rangeSum / 20,
        r5! - spy5!,
        r20! - spy20!,
        spy5!,
        spy20!,
        qqq5!,
        qqq20!,
        iwm5!,
        iwm20!,
        spyVol!,
      ],
    });
  }
  return { anchors, misalignedDates };
}

// ---------------------------------------------------------------------------
// Analogue selection
// ---------------------------------------------------------------------------

export interface NormalizationParams {
  means: number[];
  stds: number[];
}

export function fitNormalization(anchors: AnchorFeatures[]): NormalizationParams {
  const featureCount = FEATURE_NAMES.length;
  const means = new Array<number>(featureCount).fill(0);
  const stds = new Array<number>(featureCount).fill(1);
  if (!anchors.length) return { means, stds };
  for (let f = 0; f < featureCount; f++) {
    let sum = 0;
    for (const anchor of anchors) sum += anchor.vector[f]!;
    const mean = sum / anchors.length;
    let variance = 0;
    for (const anchor of anchors) variance += (anchor.vector[f]! - mean) ** 2;
    means[f] = mean;
    stds[f] = Math.sqrt(variance / anchors.length) || 1;
  }
  return { means, stds };
}

export function normalizedDistance(
  a: number[],
  b: number[],
  params: NormalizationParams,
): number {
  let sum = 0;
  for (let f = 0; f < a.length; f++) {
    const za = (a[f]! - params.means[f]!) / params.stds[f]!;
    const zb = (b[f]! - params.means[f]!) / params.stds[f]!;
    sum += (za - zb) ** 2;
  }
  return Math.sqrt(sum / a.length);
}

export interface SelectedAnalogue {
  anchor: AnchorFeatures;
  distance: number;
}

/**
 * Select up to MAX_ANALOGUES nearest historical analogues by normalized
 * distance, requiring at least ANALOGUE_MIN_SPACING_SESSIONS sessions between
 * any two selected anchor indexes so a single historical episode is not
 * over-counted.
 */
export function selectAnalogues(
  currentVector: number[],
  candidates: AnchorFeatures[],
  params: NormalizationParams,
  maxAnalogues = MAX_ANALOGUES,
  minSpacing = ANALOGUE_MIN_SPACING_SESSIONS,
): SelectedAnalogue[] {
  const scored = candidates
    .map((anchor) => ({ anchor, distance: normalizedDistance(currentVector, anchor.vector, params) }))
    .sort((a, b) => a.distance - b.distance);
  const selected: SelectedAnalogue[] = [];
  for (const item of scored) {
    if (selected.length >= maxAnalogues) break;
    const tooClose = selected.some(
      (s) => Math.abs(s.anchor.index - item.anchor.index) < minSpacing,
    );
    if (!tooClose) selected.push(item);
  }
  return selected;
}

export function forwardReturnPercent(
  closes: number[],
  index: number,
  horizonSessions: number,
): number | null {
  const end = index + horizonSessions;
  if (end >= closes.length) return null;
  const start = closes[index]!;
  if (start <= 0) return null;
  return ((closes[end]! - start) / start) * 100;
}

export interface AnalogueDistribution {
  analogueCount: number;
  upRate: number;
  medianPercent: number;
  bearPercent: number; // 20th percentile
  bullPercent: number; // 80th percentile
  dispersionPercent: number;
}

export function analogueDistribution(
  analogues: SelectedAnalogue[],
  closes: number[],
  horizonSessions: number,
): AnalogueDistribution | null {
  const outcomes: number[] = [];
  for (const analogue of analogues) {
    const fwd = forwardReturnPercent(closes, analogue.anchor.index, horizonSessions);
    if (fwd !== null && Number.isFinite(fwd)) outcomes.push(fwd);
  }
  if (outcomes.length < MIN_ANALOGUES) return null;
  outcomes.sort((a, b) => a - b);
  const up = outcomes.filter((o) => o > 0).length;
  const bear = percentile(outcomes, 0.2);
  const bull = percentile(outcomes, 0.8);
  return {
    analogueCount: outcomes.length,
    upRate: up / outcomes.length,
    medianPercent: percentile(outcomes, 0.5),
    bearPercent: bear,
    bullPercent: bull,
    dispersionPercent: bull - bear,
  };
}

// ---------------------------------------------------------------------------
// News aggregation and bounded adjustment
// ---------------------------------------------------------------------------

export interface ProjectionNewsArticle {
  headline: string;
  publisher: string | null;
  published_at: string | null;
  sentiment: string | null; // supplied by the news provider; never guessed
}

function normalizeHeadline(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

export async function fetchProjectionNews(
  symbol: string,
  apiKey: string,
): Promise<ProjectionNewsArticle[]> {
  const payload = await massiveGet(
    "/v2/reference/news",
    { ticker: symbol, order: "desc", sort: "published_utc", limit: "10" },
    apiKey,
  );
  const articles: ProjectionNewsArticle[] = [];
  const seen = new Set<string>();
  for (const item of asArray(payload["results"])) {
    const article = asRecord(item);
    const tickers = asArray(article["tickers"]).map((t) => String(t).toUpperCase());
    if (!tickers.includes(symbol.toUpperCase())) continue;
    const headline = typeof article["title"] === "string" ? article["title"].slice(0, 300) : "";
    if (!headline) continue;
    const key = normalizeHeadline(headline);
    if (seen.has(key)) continue; // dedupe near-identical headlines
    seen.add(key);
    let sentiment: string | null = null;
    for (const insightValue of asArray(article["insights"])) {
      const insight = asRecord(insightValue);
      if (String(insight["ticker"] ?? "").toUpperCase() === symbol.toUpperCase()) {
        sentiment = typeof insight["sentiment"] === "string" ? insight["sentiment"] : null;
        break;
      }
    }
    const publisher = asRecord(article["publisher"]);
    articles.push({
      headline,
      publisher: typeof publisher["name"] === "string" ? publisher["name"] : null,
      published_at:
        typeof article["published_utc"] === "string" ? article["published_utc"] : null,
      sentiment,
    });
    if (articles.length >= 5) break;
  }
  return articles;
}

/**
 * Deterministic aggregate news score in [-1, +1].
 *
 * Each article with supplied sentiment contributes sign(sentiment) weighted by
 * w = exp(-ageHours / 48) * (currentCatalyst ? 1.5 : 1). The score is the
 * weighted mean over articles that supplied sentiment; articles without
 * supplied sentiment contribute exactly zero and are counted as "unknown".
 */
export function aggregateNews(
  articles: ProjectionNewsArticle[],
  nowMs: number,
  catalystMaxAgeHours: number,
): NewsAnalysis {
  const notes: string[] = [];
  const used: NewsArticleUsed[] = [];
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let unknown = 0;
  let weightedSum = 0;
  let weightTotal = 0;
  let anyCurrentCatalyst = false;

  for (const article of articles) {
    const publishedMs = article.published_at ? Date.parse(article.published_at) : NaN;
    const ageHours = Number.isFinite(publishedMs) ? (nowMs - publishedMs) / 3_600_000 : null;
    const isCatalyst = ageHours !== null && ageHours <= catalystMaxAgeHours;
    if (isCatalyst) anyCurrentCatalyst = true;
    const sentiment = article.sentiment?.toLowerCase() ?? null;
    const signal =
      sentiment === "positive" ? 1 : sentiment === "negative" ? -1 : sentiment === "neutral" ? 0 : null;
    if (signal === null) unknown += 1;
    else if (signal > 0) positive += 1;
    else if (signal < 0) negative += 1;
    else neutral += 1;
    if (signal !== null) {
      const weight =
        Math.exp(-(ageHours ?? catalystMaxAgeHours * 4) / NEWS_RECENCY_HALF_LIFE_HOURS) *
        (isCatalyst ? 1.5 : 1);
      weightedSum += weight * signal;
      weightTotal += weight;
    }
    used.push({
      headline: article.headline,
      publisher: article.publisher,
      published_at: article.published_at,
      supplied_sentiment: sentiment,
      age_hours: ageHours !== null ? round(ageHours, 1) : null,
      is_current_catalyst: isCatalyst,
    });
  }

  const withSentiment = positive + negative + neutral;
  const score = weightTotal > 0 ? clamp(weightedSum / weightTotal, -1, 1) : 0;
  const coverage: NewsAnalysis["coverage_quality"] = !articles.length
    ? "unavailable"
    : withSentiment >= 3
      ? "strong"
      : withSentiment === 2
        ? "moderate"
        : "weak";
  const agreement: NewsAnalysis["sentiment_agreement"] =
    positive > 0 && negative > 0 ? "conflicting" : positive + negative > 0 ? "aligned" : "none";
  const trendOnly = withSentiment === 0;
  if (trendOnly) {
    notes.push(
      articles.length
        ? "No article supplied sentiment — news adjustment is exactly zero (trend-and-market-only projection)."
        : "No ticker-specific news articles were available — trend-and-market-only projection.",
    );
  }
  if (agreement === "conflicting") notes.push("Article sentiments conflict; the news adjustment is scaled down.");
  return {
    aggregate_news_score: round(score, 4),
    positive_count: positive,
    negative_count: negative,
    neutral_count: neutral,
    unknown_sentiment_count: unknown,
    coverage_quality: coverage,
    sentiment_agreement: agreement,
    trend_and_market_only: trendOnly,
    articles_used: used,
    notes,
    // internal flag surfaced via notes; catalyst presence used by adjustment
  };
}

/**
 * Bounded news adjustment in percentage points for one horizon.
 *
 * adjustment = score × cap × qualityFactor × agreementFactor × catalystFactor,
 * clamped to ±cap. Exactly zero when no article supplied sentiment.
 * Factors: quality strong 1.0 / moderate 0.7 / weak 0.4 / unavailable 0;
 * agreement conflicting 0.5 else 1.0; current catalyst present 1.0 else 0.6.
 */
export function newsAdjustmentPercent(
  analysis: NewsAnalysis,
  horizon: HorizonKey,
  anyCurrentCatalyst: boolean,
): number {
  if (analysis.trend_and_market_only) return 0;
  const cap = NEWS_ADJUSTMENT_CAP_PP[horizon];
  const quality =
    analysis.coverage_quality === "strong"
      ? 1
      : analysis.coverage_quality === "moderate"
        ? 0.7
        : analysis.coverage_quality === "weak"
          ? 0.4
          : 0;
  const agreementFactor = analysis.sentiment_agreement === "conflicting" ? 0.5 : 1;
  const catalystFactor = anyCurrentCatalyst ? 1 : 0.6;
  return round(
    clamp(analysis.aggregate_news_score * cap * quality * agreementFactor * catalystFactor, -cap, cap),
    4,
  );
}

export function hasCurrentCatalyst(analysis: NewsAnalysis): boolean {
  return analysis.articles_used.some((a) => a.is_current_catalyst);
}

// ---------------------------------------------------------------------------
// Walk-forward backtest
// ---------------------------------------------------------------------------

/**
 * Honest walk-forward test: at each evaluation anchor, only anchors whose
 * 20-session forward window completed strictly before the evaluation anchor
 * are eligible as analogues, and normalization is refit on that prior subset.
 */
export function walkForwardBacktest(
  anchors: AnchorFeatures[],
  closes: number[],
): CandidateBacktest {
  const results: Record<HorizonKey, { errors: number[]; correct: number; total: number; covered: number }> = {
    one_day: { errors: [], correct: 0, total: 0, covered: 0 },
    five_day: { errors: [], correct: 0, total: 0, covered: 0 },
    twenty_day: { errors: [], correct: 0, total: 0, covered: 0 },
  };
  const maxHorizon = HORIZON_DAYS.twenty_day;
  for (let e = 0; e < anchors.length; e += BACKTEST_STEP_SESSIONS) {
    const evalAnchor = anchors[e]!;
    const priorAnchors = anchors.filter(
      (a) => a.index + maxHorizon < evalAnchor.index,
    );
    if (priorAnchors.length < MIN_ANALOGUES * 2) continue;
    const params = fitNormalization(priorAnchors);
    const analogues = selectAnalogues(evalAnchor.vector, priorAnchors, params);
    for (const horizon of HORIZON_KEYS) {
      const sessions = HORIZON_DAYS[horizon];
      const actual = forwardReturnPercent(closes, evalAnchor.index, sessions);
      if (actual === null) continue;
      const dist = analogueDistribution(analogues, closes, sessions);
      if (!dist) continue;
      const bucket = results[horizon];
      bucket.total += 1;
      bucket.errors.push(Math.abs(dist.medianPercent - actual));
      if (Math.sign(dist.medianPercent) === Math.sign(actual) && dist.medianPercent !== 0) {
        bucket.correct += 1;
      }
      if (actual >= dist.bearPercent && actual <= dist.bullPercent) bucket.covered += 1;
    }
  }

  const toResult = (horizon: HorizonKey): BacktestHorizonResult => {
    const bucket = results[horizon];
    if (bucket.total < BACKTEST_MIN_SAMPLES) {
      return {
        status: "insufficient_history",
        samples: bucket.total,
        directional_accuracy: null,
        median_absolute_error_percent: null,
        mean_absolute_error_percent: null,
        interval_coverage: null,
      };
    }
    const sortedErrors = [...bucket.errors].sort((a, b) => a - b);
    return {
      status: "available",
      samples: bucket.total,
      directional_accuracy: round(bucket.correct / bucket.total, 4),
      median_absolute_error_percent: round(percentile(sortedErrors, 0.5), 4),
      mean_absolute_error_percent: round(
        bucket.errors.reduce((a, b) => a + b, 0) / bucket.errors.length,
        4,
      ),
      interval_coverage: round(bucket.covered / bucket.total, 4),
    };
  };

  return {
    method:
      "Walk-forward: every 5th anchor is an evaluation point; analogues are drawn only from anchors whose 20-session forward window completed strictly before the evaluation date, with normalization refit on that prior subset. Predicted median vs actual forward return.",
    one_day: toResult("one_day"),
    five_day: toResult("five_day"),
    twenty_day: toResult("twenty_day"),
  };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export function projectionConfidence(input: {
  analogueCount: number;
  averageDistance: number | null;
  twentyDayDispersionPercent: number | null;
  backtestDirectionalAccuracy: number | null;
  newsQuality: NewsAnalysis["coverage_quality"];
  quoteFreshness: "live_fresh" | "stale" | "completed_close";
  missingHorizons: number;
  misalignedDates: number;
}): { score: number; label: "high" | "moderate" | "low"; components: ConfidenceComponents } {
  const analoguePoints = round(clamp((input.analogueCount / MAX_ANALOGUES) * 20, 0, 20), 2);
  const similarityPoints =
    input.averageDistance === null
      ? 0
      : round(15 * clamp(1 - input.averageDistance / 2.5, 0, 1), 2);
  const dispersionPoints =
    input.twentyDayDispersionPercent === null
      ? 0
      : round(15 * clamp(1 - input.twentyDayDispersionPercent / 30, 0, 1), 2);
  const backtestPoints =
    input.backtestDirectionalAccuracy === null
      ? 5
      : round(20 * clamp((input.backtestDirectionalAccuracy - 0.4) / 0.3, 0, 1), 2);
  const newsPoints =
    input.newsQuality === "strong" ? 10 : input.newsQuality === "moderate" ? 7 : input.newsQuality === "weak" ? 4 : 2;
  const freshnessPoints =
    input.quoteFreshness === "live_fresh" ? 10 : input.quoteFreshness === "stale" ? 5 : 3;
  const completenessPoints = round(
    clamp(10 - input.missingHorizons * 3 - Math.min(2, input.misalignedDates / 20), 0, 10),
    2,
  );
  const components: ConfidenceComponents = {
    analogue_count_points: analoguePoints,
    analogue_similarity_points: similarityPoints,
    outcome_dispersion_points: dispersionPoints,
    backtest_points: backtestPoints,
    news_quality_points: newsPoints,
    quote_freshness_points: freshnessPoints,
    data_completeness_points: completenessPoints,
  };
  const score = Math.round(
    clamp(
      analoguePoints +
        similarityPoints +
        dispersionPoints +
        backtestPoints +
        newsPoints +
        freshnessPoints +
        completenessPoints,
      0,
      100,
    ),
  );
  const label = score >= 75 ? "high" : score >= 50 ? "moderate" : "low";
  return { score, label, components };
}

// ---------------------------------------------------------------------------
// Market regime
// ---------------------------------------------------------------------------

export function characterizeRegime(benchmarks: BenchmarkSeries): MarketRegime {
  const rule =
    "risk_on when SPY 20-session return > +2% and 5-session return > 0; risk_off when SPY 20-session return < -2% and 5-session return < 0; otherwise neutral.";
  const spyCloses = benchmarks.spy.map((b) => b.close);
  const qqqCloses = benchmarks.qqq.map((b) => b.close);
  const iwmCloses = benchmarks.iwm.map((b) => b.close);
  const last = spyCloses.length - 1;
  if (last < 20 || qqqCloses.length < 21 || iwmCloses.length < 21) {
    return {
      benchmark_data_through: benchmarks.spy.at(-1)?.date ?? null,
      spy_five_session_return_percent: null,
      spy_twenty_session_return_percent: null,
      qqq_five_session_return_percent: null,
      qqq_twenty_session_return_percent: null,
      iwm_five_session_return_percent: null,
      iwm_twenty_session_return_percent: null,
      spy_twenty_session_volatility_percent: null,
      regime: "unavailable",
      regime_rule: rule,
    };
  }
  const spy5 = returnOver(spyCloses, last, 5);
  const spy20 = returnOver(spyCloses, last, 20);
  const regime: MarketRegime["regime"] =
    spy5 === null || spy20 === null
      ? "unavailable"
      : spy20 > 2 && spy5 > 0
        ? "risk_on"
        : spy20 < -2 && spy5 < 0
          ? "risk_off"
          : "neutral";
  return {
    benchmark_data_through: benchmarks.spy.at(-1)?.date ?? null,
    spy_five_session_return_percent: spy5 !== null ? round(spy5) : null,
    spy_twenty_session_return_percent: spy20 !== null ? round(spy20) : null,
    qqq_five_session_return_percent: round(returnOver(qqqCloses, qqqCloses.length - 1, 5) ?? NaN) || null,
    qqq_twenty_session_return_percent: round(returnOver(qqqCloses, qqqCloses.length - 1, 20) ?? NaN) || null,
    iwm_five_session_return_percent: round(returnOver(iwmCloses, iwmCloses.length - 1, 5) ?? NaN) || null,
    iwm_twenty_session_return_percent: round(returnOver(iwmCloses, iwmCloses.length - 1, 20) ?? NaN) || null,
    spy_twenty_session_volatility_percent: round(realizedVolatility(spyCloses, last, 20) ?? NaN) || null,
    regime,
    regime_rule: rule,
  };
}

// ---------------------------------------------------------------------------
// Anchor price
// ---------------------------------------------------------------------------

export function resolveAnchorPrice(
  candidate: EnrichedCandidate,
  latestClose: number | null,
  now: Date,
  session: MarketSession,
): {
  price: number | null;
  source: CandidateProjection["anchor_price_source"];
  timestamp: string | null;
  freshness: "live_fresh" | "stale" | "completed_close";
  notes: string[];
} {
  const notes: string[] = [];
  const quote = candidate.live_quote;
  if (quote && quote.current_price !== null && quote.current_price > 0) {
    const ts = quote.data_timestamp ? Date.parse(quote.data_timestamp) : NaN;
    const ageMinutes = Number.isFinite(ts) ? (now.getTime() - ts) / 60_000 : null;
    const fresh = ageMinutes !== null && ageMinutes <= QUOTE_FRESH_MINUTES;
    if (fresh) {
      if (session !== "regular") {
        notes.push(`Anchor is a live Robinhood quote outside regular hours (session: ${session}).`);
      }
      return {
        price: quote.current_price,
        source: "robinhood_quote_fallback",
        timestamp: quote.data_timestamp,
        freshness: "live_fresh",
        notes,
      };
    }
    notes.push(
      `Robinhood fallback quote is ${ageMinutes !== null ? Math.round(ageMinutes) : "unknown"} minutes old (freshness threshold ${QUOTE_FRESH_MINUTES}m); anchored to it as stale.`,
    );
    return {
      price: quote.current_price,
      source: "robinhood_quote_fallback",
      timestamp: quote.data_timestamp,
      freshness: "stale",
      notes,
    };
  }
  const snapshotPrice = candidate.live_snapshot?.current_price ?? null;
  if (snapshotPrice !== null && snapshotPrice > 0) {
    return {
      price: snapshotPrice,
      source: "massive_snapshot",
      timestamp: candidate.live_snapshot?.data_timestamp ?? null,
      freshness: "stale",
      notes,
    };
  }
  if (latestClose !== null && latestClose > 0) {
    notes.push(
      "No live quote was available — projections are anchored to the latest completed close, not a live regular-session price.",
    );
    return { price: latestClose, source: "latest_completed_close", timestamp: null, freshness: "completed_close", notes };
  }
  notes.push("No anchor price available from any source.");
  return { price: null, source: "unavailable", timestamp: null, freshness: "completed_close", notes };
}

// ---------------------------------------------------------------------------
// Orchestration + caching
// ---------------------------------------------------------------------------

interface BenchmarkCache {
  expiresAt: number;
  series: BenchmarkSeries;
}
let benchmarkCache: BenchmarkCache | null = null;

interface ProjectionCache {
  expiresAt: number;
  key: string;
  result: ProjectionResult;
}
let projectionCache: ProjectionCache | null = null;
const activeProjections = new Map<string, Promise<ProjectionResult>>();
let lastProjectionResult: ProjectionResult | null = null;

/** Latest completed projection for server-side consumers (AI assistant context). */
export function getLastProjection(): ProjectionResult | null {
  return lastProjectionResult;
}

/** Test hook: reset module caches. */
export function resetProjectionCaches(): void {
  benchmarkCache = null;
  projectionCache = null;
  activeProjections.clear();
  lastProjectionResult = null;
}

async function getBenchmarks(apiKey: string, now: Date, forceRefresh: boolean): Promise<BenchmarkSeries> {
  if (!forceRefresh && benchmarkCache && benchmarkCache.expiresAt > now.getTime()) {
    return benchmarkCache.series;
  }
  const [spy, qqq, iwm] = await Promise.all([
    fetchDailyBars("SPY", apiKey, now),
    fetchDailyBars("QQQ", apiKey, now),
    fetchDailyBars("IWM", apiKey, now),
  ]);
  const series: BenchmarkSeries = { spy, qqq, iwm };
  benchmarkCache = { expiresAt: now.getTime() + PROJECTION_CACHE_SECONDS * 1_000, series };
  return series;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function unavailableHorizon(reason: string): HorizonProjection {
  return {
    status: "unavailable",
    unavailable_reason: reason,
    analogue_count: 0,
    historical_up_rate: null,
    unadjusted_median_return_percent: null,
    median_return_percent: null,
    bear_return_percent: null,
    bull_return_percent: null,
    news_adjustment_percent: null,
    news_adjustment_cap_percent: 0,
    dispersion_percent: null,
    base_price: null,
    bear_price: null,
    bull_price: null,
  };
}

function unavailableCandidate(
  symbol: string,
  rank: number,
  reason: string,
  notes: string[],
): CandidateProjection {
  return {
    symbol,
    rank,
    anchor_price: null,
    anchor_price_source: "unavailable",
    quote_timestamp: null,
    projection_status: "unavailable",
    unavailable_reason: reason,
    direction_bias: "neutral",
    direction_rule: DIRECTION_RULE,
    projection_confidence_score: 0,
    projection_confidence_label: "low",
    confidence_components: {
      analogue_count_points: 0,
      analogue_similarity_points: 0,
      outcome_dispersion_points: 0,
      backtest_points: 0,
      news_quality_points: 0,
      quote_freshness_points: 0,
      data_completeness_points: 0,
    },
    news_analysis: null,
    drivers: [],
    risks: [reason],
    data_quality_notes: notes,
    usable_sessions: 0,
    horizons: {
      one_day: unavailableHorizon(reason),
      five_day: unavailableHorizon(reason),
      twenty_day: unavailableHorizon(reason),
    },
    backtest: null,
  };
}

export const DIRECTION_RULE = `bullish when the news-adjusted five-day median return is > 0 and the historical analogue up-rate is >= ${DIRECTION_UP_RATE_BULL}; bearish when the adjusted median is < 0 and the up-rate is <= ${DIRECTION_UP_RATE_BEAR}; otherwise neutral. Falls back to the twenty-day horizon when five-day is unavailable.`;

export function directionBias(
  horizons: CandidateProjection["horizons"],
): "bullish" | "neutral" | "bearish" {
  const primary =
    horizons.five_day.status === "available"
      ? horizons.five_day
      : horizons.twenty_day.status === "available"
        ? horizons.twenty_day
        : horizons.one_day.status === "available"
          ? horizons.one_day
          : null;
  if (!primary || primary.median_return_percent === null || primary.historical_up_rate === null) {
    return "neutral";
  }
  if (primary.median_return_percent > 0 && primary.historical_up_rate >= DIRECTION_UP_RATE_BULL) {
    return "bullish";
  }
  if (primary.median_return_percent < 0 && primary.historical_up_rate <= DIRECTION_UP_RATE_BEAR) {
    return "bearish";
  }
  return "neutral";
}

async function projectCandidate(
  candidate: EnrichedCandidate,
  rank: number,
  benchmarks: BenchmarkSeries,
  apiKey: string,
  now: Date,
  session: MarketSession,
  config: ReturnType<typeof liveScanConfig>,
): Promise<CandidateProjection> {
  const notes: string[] = [];
  const symbol = candidate.symbol;

  // 1) Candidate daily history.
  let bars: DailyBar[];
  try {
    bars = await fetchDailyBars(symbol, apiKey, now);
  } catch (error) {
    const reason =
      error instanceof MassiveRequestError && error.planRestricted
        ? `Completed daily historical bars are not available on the current Massive plan: ${error.message.slice(0, 160)}`
        : `Historical daily bar request failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
    return unavailableCandidate(symbol, rank, reason, notes);
  }
  if (bars.length < MIN_USABLE_SESSIONS) {
    return unavailableCandidate(
      symbol,
      rank,
      `Only ${bars.length} completed daily sessions were available (minimum ${MIN_USABLE_SESSIONS}).`,
      notes,
    );
  }
  if (bars.length < 300) {
    notes.push(`Only ${bars.length} completed sessions available (300–500 preferred); analogue pool is smaller.`);
  }

  const closes = bars.map((b) => b.close);
  const latestClose = closes.at(-1) ?? null;

  // 2) Features + analogues.
  const { anchors, misalignedDates } = buildAnchorFeatures(bars, benchmarks);
  if (misalignedDates > 0) {
    notes.push(`${misalignedDates} session(s) skipped because benchmark dates were not aligned.`);
  }
  const currentAnchor = anchors.find((a) => a.index === bars.length - 1) ?? null;
  if (!currentAnchor) {
    return unavailableCandidate(
      symbol,
      rank,
      "The latest completed session could not be aligned with benchmark data, so no current feature vector exists.",
      notes,
    );
  }
  const historicalAnchors = anchors.filter(
    (a) => a.index < currentAnchor.index,
  );
  const params = fitNormalization(historicalAnchors);
  const analogues = selectAnalogues(currentAnchor.vector, historicalAnchors, params);

  // 3) News (deterministic; no AI-generated sentiment).
  let newsAnalysis: NewsAnalysis;
  try {
    const articles = await fetchProjectionNews(symbol, apiKey);
    newsAnalysis = aggregateNews(articles, now.getTime(), config.newsCatalystMaxAgeHours);
  } catch (error) {
    newsAnalysis = aggregateNews([], now.getTime(), config.newsCatalystMaxAgeHours);
    newsAnalysis.notes.push(
      `News request failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); projection is trend-and-market-only.`,
    );
  }
  const anyCatalyst = hasCurrentCatalyst(newsAnalysis);

  // 4) Anchor price.
  const anchor = resolveAnchorPrice(candidate, latestClose, now, session);
  notes.push(...anchor.notes);
  if (session === "closed" && anchor.source === "latest_completed_close") {
    notes.push("Market is closed; the anchor is the latest completed close, not a live regular-session price.");
  }
  if (anchor.price === null) {
    return unavailableCandidate(symbol, rank, "No anchor price is available from any source.", notes);
  }

  // 5) Horizon projections.
  const horizons = {} as CandidateProjection["horizons"];
  let twentyDayDispersion: number | null = null;
  for (const horizon of HORIZON_KEYS) {
    const sessions = HORIZON_DAYS[horizon];
    const dist = analogueDistribution(analogues, closes, sessions);
    if (!dist) {
      horizons[horizon] = unavailableHorizon(
        `Fewer than ${MIN_ANALOGUES} spaced historical analogues have valid ${sessions}-session forward outcomes.`,
      );
      continue;
    }
    const adjustment = newsAdjustmentPercent(newsAnalysis, horizon, anyCatalyst);
    const adjMedian = dist.medianPercent + adjustment;
    const adjBear = dist.bearPercent + adjustment;
    const adjBull = dist.bullPercent + adjustment;
    const basePrice = anchor.price * (1 + adjMedian / 100);
    const bearPrice = anchor.price * (1 + adjBear / 100);
    const bullPrice = anchor.price * (1 + adjBull / 100);
    if (horizon === "twenty_day") twentyDayDispersion = dist.dispersionPercent;
    horizons[horizon] = {
      status: "available",
      unavailable_reason: null,
      analogue_count: dist.analogueCount,
      historical_up_rate: round(dist.upRate, 4),
      unadjusted_median_return_percent: round(dist.medianPercent, 4),
      median_return_percent: round(adjMedian, 4),
      bear_return_percent: round(adjBear, 4),
      bull_return_percent: round(adjBull, 4),
      news_adjustment_percent: adjustment,
      news_adjustment_cap_percent: NEWS_ADJUSTMENT_CAP_PP[horizon],
      dispersion_percent: round(dist.dispersionPercent, 4),
      base_price: round(Math.min(Math.max(basePrice, bearPrice), bullPrice), 4),
      bear_price: round(Math.min(bearPrice, basePrice, bullPrice), 4),
      bull_price: round(Math.max(bullPrice, basePrice, bearPrice), 4),
    };
  }
  const missingHorizons = HORIZON_KEYS.filter((h) => horizons[h].status === "unavailable").length;
  if (missingHorizons === HORIZON_KEYS.length) {
    const reason = horizons.one_day.unavailable_reason ?? "No horizon had enough analogues.";
    return unavailableCandidate(symbol, rank, reason, notes);
  }

  // 6) Backtest.
  const backtest = walkForwardBacktest(anchors, closes);

  // 7) Confidence.
  const avgDistance = analogues.length
    ? analogues.reduce((a, b) => a + b.distance, 0) / analogues.length
    : null;
  const confidence = projectionConfidence({
    analogueCount: analogues.length,
    averageDistance: avgDistance,
    twentyDayDispersionPercent: twentyDayDispersion,
    backtestDirectionalAccuracy: backtest.five_day.directional_accuracy,
    newsQuality: newsAnalysis.coverage_quality,
    quoteFreshness: anchor.freshness,
    missingHorizons,
    misalignedDates,
  });

  // 8) Drivers and risks (deterministic descriptions of the inputs).
  const drivers: string[] = [];
  const risks: string[] = [];
  const [r5, r20, , consistency, vol20, , rs5, rs20] = currentAnchor.vector;
  drivers.push(`20-session return ${round(r20!, 1)}% with ${Math.round(consistency! * 20)}/20 up sessions.`);
  drivers.push(`Relative strength vs SPY: ${round(rs5!, 1)}% (5-session), ${round(rs20!, 1)}% (20-session).`);
  if (Math.abs(newsAnalysis.aggregate_news_score) > 0.05 && !newsAnalysis.trend_and_market_only) {
    drivers.push(
      `Aggregate news score ${newsAnalysis.aggregate_news_score > 0 ? "+" : ""}${newsAnalysis.aggregate_news_score} from ${newsAnalysis.positive_count + newsAnalysis.negative_count + newsAnalysis.neutral_count} sentiment-tagged article(s).`,
    );
  }
  drivers.push(`${analogues.length} spaced historical analogues matched the current state.`);
  if (vol20! > 3) risks.push(`Elevated 20-session realized volatility (${round(vol20!, 1)}% daily).`);
  if (twentyDayDispersion !== null && twentyDayDispersion > 15) {
    risks.push(`Wide historical outcome dispersion (${round(twentyDayDispersion, 1)}pp between 20th and 80th percentile at 20 days).`);
  }
  if (newsAnalysis.sentiment_agreement === "conflicting") risks.push("News sentiment conflicts across recent articles.");
  if (newsAnalysis.trend_and_market_only) risks.push("No supplied news sentiment — projection is trend-and-market-only.");
  if (anchor.freshness !== "live_fresh") risks.push("Anchor price is not a fresh live quote.");
  if (r5! < 0 && r20! > 0) risks.push("Short-term pullback against the 20-session uptrend.");
  if (backtest.five_day.status === "insufficient_history") {
    risks.push("Backtest sample too small to validate five-day accuracy.");
  }

  return {
    symbol,
    rank,
    anchor_price: round(anchor.price, 4),
    anchor_price_source: anchor.source,
    quote_timestamp: anchor.timestamp,
    projection_status: "available",
    unavailable_reason: null,
    direction_bias: directionBias(horizons),
    direction_rule: DIRECTION_RULE,
    projection_confidence_score: confidence.score,
    projection_confidence_label: confidence.label,
    confidence_components: confidence.components,
    news_analysis: newsAnalysis,
    drivers,
    risks,
    data_quality_notes: notes,
    usable_sessions: bars.length,
    horizons,
    backtest,
  };
}

/**
 * Compute (or serve from the 15-minute cache) projections for the top five
 * candidates of the supplied enriched scan. Never trusts client-sent data.
 */
export async function computeMarketProjection(
  scan: LiveEnrichmentResult,
  apiKey: string,
  forceRefresh: boolean,
  now: Date = new Date(),
): Promise<ProjectionResult> {
  const topFive = scan.candidates.slice(0, 5);
  const cacheKey = `${topFive.map((c) => c.symbol).join(",")}|${scan.live_data_as_of ?? ""}`;
  if (!forceRefresh && projectionCache && projectionCache.expiresAt > now.getTime() && projectionCache.key === cacheKey) {
    return { ...projectionCache.result, cached: true };
  }
  const inflightKey = `${cacheKey}|force=${forceRefresh}`;
  const existing = activeProjections.get(inflightKey);
  if (!forceRefresh && existing) return existing;

  const work = (async () => {
    const clock = easternClock(now);
    const config = liveScanConfig();
    const benchmarks = await getBenchmarks(apiKey, now, forceRefresh);
    const regime = characterizeRegime(benchmarks);
    const candidates = await mapWithConcurrency(
      topFive.map((candidate, i) => ({ candidate, rank: i + 1 })),
      CANDIDATE_FETCH_CONCURRENCY,
      ({ candidate, rank }) =>
        projectCandidate(candidate, rank, benchmarks, apiKey, now, clock.session, config),
    );
    const dataThrough = candidates
      .filter((c) => c.projection_status === "available")
      .map(() => benchmarks.spy.at(-1)?.date ?? null)
      .find((d) => d !== null) ?? benchmarks.spy.at(-1)?.date ?? null;
    const result: ProjectionResult = {
      projection_mode: "trend-news-analogue-v1",
      generated_at: now.toISOString(),
      historical_data_through: dataThrough,
      market_session: clock.session,
      market_regime: regime,
      cache_seconds: PROJECTION_CACHE_SECONDS,
      cached: false,
      method_notes: [
        "Scenario bands are the 20th percentile (bear), median (base), and 80th percentile (bull) of forward returns across 30-60 spaced historical analogues selected by normalized feature distance.",
        "historical_up_rate is the share of selected historical analogues that finished higher — it is not a probability of profit.",
        `News applies a bounded, deterministic adjustment capped at ±${NEWS_ADJUSTMENT_CAP_PP.one_day}pp (1d), ±${NEWS_ADJUSTMENT_CAP_PP.five_day}pp (5d), ±${NEWS_ADJUSTMENT_CAP_PP.twenty_day}pp (20d); it is exactly zero when no article supplied sentiment.`,
        DIRECTION_RULE,
        "Projections are scenario estimates for research, not guaranteed price targets, entries, stops, or option guidance.",
      ],
      candidates,
    };
    projectionCache = {
      expiresAt: now.getTime() + PROJECTION_CACHE_SECONDS * 1_000,
      key: cacheKey,
      result,
    };
    lastProjectionResult = result;
    return result;
  })().finally(() => {
    if (activeProjections.get(inflightKey) === work) activeProjections.delete(inflightKey);
  });
  activeProjections.set(inflightKey, work);
  return work;
}
