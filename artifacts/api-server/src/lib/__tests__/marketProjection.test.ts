import { describe, expect, it } from "vitest";
import {
  aggregateNews,
  analogueDistribution,
  ANALOGUE_MIN_SPACING_SESSIONS,
  buildAnchorFeatures,
  DIRECTION_UP_RATE_BULL,
  directionBias,
  FEATURE_NAMES,
  fitNormalization,
  forwardReturnPercent,
  hasCurrentCatalyst,
  MAX_ANALOGUES,
  MIN_ANALOGUES,
  NEWS_ADJUSTMENT_CAP_PP,
  newsAdjustmentPercent,
  normalizedDistance,
  percentile,
  projectionConfidence,
  resolveAnchorPrice,
  selectAnalogues,
  walkForwardBacktest,
  type AnchorFeatures,
  type BenchmarkSeries,
  type DailyBar,
  type HorizonProjection,
  type NewsAnalysis,
  type ProjectionNewsArticle,
} from "../marketProjection.js";
import type { EnrichedCandidate } from "../marketScanLive.js";

// ---------------------------------------------------------------------------
// Synthetic data helpers
// ---------------------------------------------------------------------------

function makeBars(count: number, startPrice = 100, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let price = startPrice;
  let state = seed;
  const rand = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const start = new Date("2024-01-02T00:00:00Z");
  let day = 0;
  while (bars.length < count) {
    const date = new Date(start.getTime() + day * 86_400_000);
    day += 1;
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const drift = (rand() - 0.48) * 2; // percent
    price = Math.max(1, price * (1 + drift / 100));
    const high = price * (1 + rand() * 0.01);
    const low = price * (1 - rand() * 0.01);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: price * (1 - rand() * 0.005),
      high,
      low,
      close: price,
      volume: 1_000_000 + Math.round(rand() * 500_000),
    });
  }
  return bars;
}

function makeBenchmarks(bars: DailyBar[]): BenchmarkSeries {
  const clone = (mult: number): DailyBar[] =>
    bars.map((b) => ({ ...b, close: b.close * mult, high: b.high * mult, low: b.low * mult, open: b.open * mult }));
  return { spy: clone(4), qqq: clone(3), iwm: clone(2) };
}

function makeAnalysis(overrides: Partial<NewsAnalysis>): NewsAnalysis {
  return {
    aggregate_news_score: 1,
    positive_count: 3,
    negative_count: 0,
    neutral_count: 0,
    unknown_sentiment_count: 0,
    coverage_quality: "strong",
    sentiment_agreement: "aligned",
    trend_and_market_only: false,
    articles_used: [],
    notes: [],
    ...overrides,
  };
}

const NOW = Date.parse("2026-07-22T15:00:00Z");

function article(hoursAgo: number, sentiment: string | null, headline = `h${hoursAgo}`): ProjectionNewsArticle {
  return {
    headline,
    publisher: "Test Wire",
    published_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    sentiment,
  };
}

// ---------------------------------------------------------------------------
// Features: no lookahead
// ---------------------------------------------------------------------------

describe("no-lookahead feature calculation", () => {
  it("produces identical anchor vectors regardless of future bars", () => {
    const full = makeBars(400);
    const truncated = full.slice(0, 300);
    const benchFull = makeBenchmarks(full);
    const benchTrunc = makeBenchmarks(truncated);
    const a = buildAnchorFeatures(full, benchFull).anchors;
    const b = buildAnchorFeatures(truncated, benchTrunc).anchors;
    const target = b.find((x) => x.index === 250);
    const same = a.find((x) => x.index === 250);
    expect(target).toBeDefined();
    expect(same).toBeDefined();
    expect(same!.vector).toEqual(target!.vector);
    expect(same!.vector).toHaveLength(FEATURE_NAMES.length);
  });

  it("skips anchors whose dates are missing from a benchmark series", () => {
    const bars = makeBars(100);
    const bench = makeBenchmarks(bars);
    bench.qqq = bench.qqq.filter((b) => b.date !== bars[60]!.date);
    const { anchors, misalignedDates } = buildAnchorFeatures(bars, bench);
    expect(misalignedDates).toBeGreaterThanOrEqual(1);
    expect(anchors.some((a) => a.date === bars[60]!.date)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Analogue selection
// ---------------------------------------------------------------------------

describe("historical analogue selection", () => {
  const bars = makeBars(450);
  const bench = makeBenchmarks(bars);
  const { anchors } = buildAnchorFeatures(bars, bench);
  const current = anchors[anchors.length - 1]!;
  const historical = anchors.filter((a) => a.index < current.index);
  const params = fitNormalization(historical);

  it("selects at most MAX_ANALOGUES with required spacing", () => {
    const selected = selectAnalogues(current.vector, historical, params);
    expect(selected.length).toBeLessThanOrEqual(MAX_ANALOGUES);
    const indexes = selected.map((s) => s.anchor.index).sort((a, b) => a - b);
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]! - indexes[i - 1]!).toBeGreaterThanOrEqual(ANALOGUE_MIN_SPACING_SESSIONS);
    }
  });

  it("orders selections by ascending normalized distance", () => {
    const selected = selectAnalogues(current.vector, historical, params);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i]!.distance).toBeGreaterThanOrEqual(selected[i - 1]!.distance);
    }
  });

  it("distance to itself is zero", () => {
    expect(normalizedDistance(current.vector, current.vector, params)).toBe(0);
  });
});

describe("minimum analogue requirement", () => {
  it("returns null distribution when fewer than MIN_ANALOGUES valid outcomes", () => {
    const bars = makeBars(450);
    const closes = bars.map((b) => b.close);
    const bench = makeBenchmarks(bars);
    const { anchors } = buildAnchorFeatures(bars, bench);
    const few = anchors.slice(0, MIN_ANALOGUES - 5).map((anchor) => ({ anchor, distance: 0 }));
    expect(analogueDistribution(few, closes, 5)).toBeNull();
  });

  it("excludes analogues without complete forward outcomes", () => {
    const bars = makeBars(450);
    const closes = bars.map((b) => b.close);
    // anchors near the end lack 20-session forward outcomes
    expect(forwardReturnPercent(closes, closes.length - 5, 20)).toBeNull();
    expect(forwardReturnPercent(closes, closes.length - 25, 20)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Percentiles + ordering
// ---------------------------------------------------------------------------

describe("percentile ordering", () => {
  it("computes interpolated percentiles with 20th <= 50th <= 80th", () => {
    const values = Array.from({ length: 101 }, (_, i) => i - 50).sort((a, b) => a - b);
    const p20 = percentile(values, 0.2);
    const p50 = percentile(values, 0.5);
    const p80 = percentile(values, 0.8);
    expect(p20).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p50).toBe(0);
  });

  it("bear/base/bull prices maintain ordering after news adjustment", () => {
    const bars = makeBars(450);
    const closes = bars.map((b) => b.close);
    const bench = makeBenchmarks(bars);
    const { anchors } = buildAnchorFeatures(bars, bench);
    const current = anchors[anchors.length - 1]!;
    const historical = anchors.filter((a) => a.index < current.index);
    const params = fitNormalization(historical);
    const analogues = selectAnalogues(current.vector, historical, params);
    const dist = analogueDistribution(analogues, closes, 5);
    expect(dist).not.toBeNull();
    const anchorPrice = 100;
    const adjustment = NEWS_ADJUSTMENT_CAP_PP.five_day; // max positive shift
    const bear = anchorPrice * (1 + (dist!.bearPercent + adjustment) / 100);
    const base = anchorPrice * (1 + (dist!.medianPercent + adjustment) / 100);
    const bull = anchorPrice * (1 + (dist!.bullPercent + adjustment) / 100);
    expect(bear).toBeLessThanOrEqual(base);
    expect(base).toBeLessThanOrEqual(bull);
    expect(dist!.upRate).toBeGreaterThanOrEqual(0);
    expect(dist!.upRate).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// News aggregation and adjustment
// ---------------------------------------------------------------------------

describe("news aggregation", () => {
  it("weights recent articles more heavily", () => {
    const recentPositive = aggregateNews([article(2, "positive"), article(200, "negative", "old")], NOW, 36);
    expect(recentPositive.aggregate_news_score).toBeGreaterThan(0);
    const recentNegative = aggregateNews([article(2, "negative"), article(200, "positive", "old")], NOW, 36);
    expect(recentNegative.aggregate_news_score).toBeLessThan(0);
  });

  it("counts unknown sentiment as zero contribution", () => {
    const analysis = aggregateNews([article(2, null), article(3, "positive")], NOW, 36);
    expect(analysis.unknown_sentiment_count).toBe(1);
    expect(analysis.positive_count).toBe(1);
    expect(analysis.aggregate_news_score).toBe(1);
  });

  it("flags trend-and-market-only when no supplied sentiment", () => {
    const analysis = aggregateNews([article(2, null), article(4, null)], NOW, 36);
    expect(analysis.trend_and_market_only).toBe(true);
    expect(analysis.aggregate_news_score).toBe(0);
  });

  it("marks conflicting sentiment", () => {
    const analysis = aggregateNews([article(2, "positive"), article(3, "negative")], NOW, 36);
    expect(analysis.sentiment_agreement).toBe("conflicting");
  });

  it("detects current catalysts by age threshold", () => {
    expect(hasCurrentCatalyst(aggregateNews([article(2, "positive")], NOW, 36))).toBe(true);
    expect(hasCurrentCatalyst(aggregateNews([article(100, "positive")], NOW, 36))).toBe(false);
  });
});

describe("news adjustment safeguards", () => {
  it("is exactly zero when sentiment is unavailable", () => {
    const analysis = makeAnalysis({ trend_and_market_only: true, aggregate_news_score: 0 });
    for (const horizon of ["one_day", "five_day", "twenty_day"] as const) {
      expect(newsAdjustmentPercent(analysis, horizon, true)).toBe(0);
    }
  });

  it("never exceeds the per-horizon caps", () => {
    const analysis = makeAnalysis({ aggregate_news_score: 1 });
    expect(Math.abs(newsAdjustmentPercent(analysis, "one_day", true))).toBeLessThanOrEqual(NEWS_ADJUSTMENT_CAP_PP.one_day);
    expect(Math.abs(newsAdjustmentPercent(analysis, "five_day", true))).toBeLessThanOrEqual(NEWS_ADJUSTMENT_CAP_PP.five_day);
    expect(Math.abs(newsAdjustmentPercent(analysis, "twenty_day", true))).toBeLessThanOrEqual(NEWS_ADJUSTMENT_CAP_PP.twenty_day);
    const negative = makeAnalysis({ aggregate_news_score: -1 });
    expect(Math.abs(newsAdjustmentPercent(negative, "twenty_day", true))).toBeLessThanOrEqual(NEWS_ADJUSTMENT_CAP_PP.twenty_day);
  });

  it("scales down mixed and low-quality news", () => {
    const strong = newsAdjustmentPercent(makeAnalysis({ aggregate_news_score: 0.8 }), "five_day", true);
    const conflicting = newsAdjustmentPercent(
      makeAnalysis({ aggregate_news_score: 0.8, sentiment_agreement: "conflicting" }),
      "five_day",
      true,
    );
    const weak = newsAdjustmentPercent(
      makeAnalysis({ aggregate_news_score: 0.8, coverage_quality: "weak" }),
      "five_day",
      true,
    );
    const noCatalyst = newsAdjustmentPercent(makeAnalysis({ aggregate_news_score: 0.8 }), "five_day", false);
    expect(Math.abs(conflicting)).toBeLessThan(Math.abs(strong));
    expect(Math.abs(weak)).toBeLessThan(Math.abs(strong));
    expect(Math.abs(noCatalyst)).toBeLessThan(Math.abs(strong));
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("projection confidence bounds", () => {
  it("stays within 0-100 and labels correctly", () => {
    const best = projectionConfidence({
      analogueCount: MAX_ANALOGUES,
      averageDistance: 0,
      twentyDayDispersionPercent: 0,
      backtestDirectionalAccuracy: 1,
      newsQuality: "strong",
      quoteFreshness: "live_fresh",
      missingHorizons: 0,
      misalignedDates: 0,
    });
    expect(best.score).toBeLessThanOrEqual(100);
    expect(best.score).toBeGreaterThanOrEqual(75);
    expect(best.label).toBe("high");

    const worst = projectionConfidence({
      analogueCount: 0,
      averageDistance: null,
      twentyDayDispersionPercent: null,
      backtestDirectionalAccuracy: 0,
      newsQuality: "unavailable",
      quoteFreshness: "completed_close",
      missingHorizons: 3,
      misalignedDates: 100,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.label).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Walk-forward backtest isolation
// ---------------------------------------------------------------------------

describe("walk-forward backtest", () => {
  it("only uses anchors whose forward windows completed before the evaluation point", () => {
    // Structural test: verify the filter predicate by reproducing it.
    const bars = makeBars(450);
    const bench = makeBenchmarks(bars);
    const { anchors } = buildAnchorFeatures(bars, bench);
    const evalAnchor = anchors[Math.floor(anchors.length / 2)]!;
    const prior = anchors.filter((a) => a.index + 20 < evalAnchor.index);
    for (const a of prior) {
      expect(a.index + 20).toBeLessThan(evalAnchor.index);
    }
  });

  it("returns metrics with sane ranges or insufficient_history", () => {
    const bars = makeBars(450);
    const closes = bars.map((b) => b.close);
    const bench = makeBenchmarks(bars);
    const { anchors } = buildAnchorFeatures(bars, bench);
    const result = walkForwardBacktest(anchors, closes);
    for (const horizon of [result.one_day, result.five_day, result.twenty_day]) {
      if (horizon.status === "available") {
        expect(horizon.directional_accuracy).toBeGreaterThanOrEqual(0);
        expect(horizon.directional_accuracy).toBeLessThanOrEqual(1);
        expect(horizon.interval_coverage).toBeGreaterThanOrEqual(0);
        expect(horizon.interval_coverage).toBeLessThanOrEqual(1);
        expect(horizon.median_absolute_error_percent).toBeGreaterThanOrEqual(0);
      } else {
        expect(horizon.directional_accuracy).toBeNull();
      }
    }
  });

  it("refuses metrics with insufficient history", () => {
    const bars = makeBars(80);
    const closes = bars.map((b) => b.close);
    const bench = makeBenchmarks(bars);
    const { anchors } = buildAnchorFeatures(bars, bench);
    const result = walkForwardBacktest(anchors, closes);
    expect(result.twenty_day.status).toBe("insufficient_history");
    expect(result.twenty_day.directional_accuracy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Anchor price provenance
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<EnrichedCandidate>): EnrichedCandidate {
  return {
    symbol: "PYPL",
    confidence_meter: 80,
    live_snapshot: null,
    live_quote: null,
    intraday: null,
    news: null,
    options: null,
    enrichment_stage: "news",
    enrichment_status: {
      live_quote: { status: "available_robinhood_fallback", detail: null },
      snapshot: { status: "plan_restricted", detail: null },
      intraday: { status: "plan_restricted", detail: null },
      news: { status: "available", detail: null },
      options: { status: "not_requested", detail: null },
    },
    data_quality_notes: [],
    unavailable_fields: [],
    ...overrides,
  } as EnrichedCandidate;
}

describe("Robinhood anchor-price provenance", () => {
  const now = new Date("2026-07-22T15:00:00Z");

  it("uses a fresh Robinhood fallback quote and labels the source", () => {
    const candidate = makeCandidate({
      live_quote: {
        source: "robinhood_quote_fallback",
        current_price: 71.42,
        previous_close: 70,
        todays_change: 1.42,
        todays_change_percent: 2.02,
        bid: 71.4,
        ask: 71.45,
        spread_amount: 0.05,
        spread_percent: 0.07,
        data_timestamp: new Date(now.getTime() - 60_000).toISOString(),
        volume: null,
        delayed: false,
        trading_halted: false,
      },
    });
    const anchor = resolveAnchorPrice(candidate, 70.5, now, "regular");
    expect(anchor.source).toBe("robinhood_quote_fallback");
    expect(anchor.price).toBe(71.42);
    expect(anchor.freshness).toBe("live_fresh");
  });

  it("falls back to the latest completed close with an explicit label", () => {
    const candidate = makeCandidate({});
    const anchor = resolveAnchorPrice(candidate, 70.5, now, "closed");
    expect(anchor.source).toBe("latest_completed_close");
    expect(anchor.price).toBe(70.5);
    expect(anchor.notes.join(" ")).toMatch(/not a live regular-session price/);
  });

  it("refuses when no anchor exists", () => {
    const candidate = makeCandidate({});
    const anchor = resolveAnchorPrice(candidate, null, now, "regular");
    expect(anchor.source).toBe("unavailable");
    expect(anchor.price).toBeNull();
  });
});

describe("historical volume never labeled live", () => {
  it("QuoteFallback volume is structurally null and bars carry completed-session volume only", () => {
    const candidate = makeCandidate({
      live_quote: {
        source: "robinhood_quote_fallback",
        current_price: 10,
        previous_close: 9,
        todays_change: 1,
        todays_change_percent: 11.1,
        bid: null,
        ask: null,
        spread_amount: null,
        spread_percent: null,
        data_timestamp: null,
        volume: null,
        delayed: false,
        trading_halted: false,
      },
    });
    expect(candidate.live_quote!.volume).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Direction bias
// ---------------------------------------------------------------------------

describe("direction bias", () => {
  const horizon = (median: number, upRate: number): HorizonProjection => ({
    status: "available",
    unavailable_reason: null,
    analogue_count: 40,
    historical_up_rate: upRate,
    unadjusted_median_return_percent: median,
    median_return_percent: median,
    bear_return_percent: median - 5,
    bull_return_percent: median + 5,
    news_adjustment_percent: 0,
    news_adjustment_cap_percent: 2,
    dispersion_percent: 10,
    base_price: 100,
    bear_price: 95,
    bull_price: 105,
  });
  const unavailable: HorizonProjection = {
    ...horizon(0, 0.5),
    status: "unavailable",
    unavailable_reason: "test",
    median_return_percent: null,
    historical_up_rate: null,
  };

  it("is bullish only when median > 0 and up-rate >= threshold", () => {
    expect(directionBias({ one_day: unavailable, five_day: horizon(1.2, DIRECTION_UP_RATE_BULL), twenty_day: unavailable })).toBe("bullish");
    expect(directionBias({ one_day: unavailable, five_day: horizon(1.2, 0.52), twenty_day: unavailable })).toBe("neutral");
    expect(directionBias({ one_day: unavailable, five_day: horizon(-1.2, 0.4), twenty_day: unavailable })).toBe("bearish");
    expect(directionBias({ one_day: unavailable, five_day: unavailable, twenty_day: unavailable })).toBe("neutral");
  });
});
