import { beforeEach, describe, expect, it, vi } from "vitest";

const massiveGetMock = vi.fn();

vi.mock("../marketScanLive.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../marketScanLive.js")>();
  return {
    ...original,
    massiveGet: (...args: unknown[]) => massiveGetMock(...args),
  };
});

import {
  computeMarketProjection,
  computeTickerProjection,
  getLastTickerProjection,
  resetProjectionCaches,
  PROJECTION_CACHE_SECONDS,
  type ProjectionSubject,
} from "../marketProjection.js";
import type { EnrichedCandidate, LiveEnrichmentResult, QuoteFallback } from "../marketScanLive.js";

const NOW = new Date("2026-07-21T15:00:00Z"); // a Tuesday, regular hours ET

function barsPayload(count: number, startPrice: number) {
  const results: Array<Record<string, number>> = [];
  const start = Date.parse("2024-01-02T21:00:00Z");
  let price = startPrice;
  let day = 0;
  while (results.length < count) {
    const t = start + day * 86_400_000;
    day += 1;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    price = Math.max(1, price * (1 + (((results.length * 7919) % 13) - 6) / 600));
    results.push({ t, o: price * 0.995, h: price * 1.01, l: price * 0.99, c: price, v: 1_000_000 });
  }
  return { results };
}

function quote(): QuoteFallback {
  return {
    source: "robinhood_quote_fallback",
    current_price: 100,
    previous_close: 99,
    todays_change: 1,
    todays_change_percent: 1.01,
    bid: 99.9,
    ask: 100.1,
    spread_amount: 0.2,
    spread_percent: 0.2,
    data_timestamp: new Date(NOW.getTime() - 60_000).toISOString(),
    volume: null,
    delayed: false,
    trading_halted: false,
  };
}

function subject(symbol: string, withQuote = true): ProjectionSubject {
  return { symbol, live_quote: withQuote ? quote() : null, live_snapshot: null };
}

function candidate(symbol: string): EnrichedCandidate {
  return {
    symbol,
    confidence_meter: 80,
    live_snapshot: null,
    live_quote: quote(),
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
  } as EnrichedCandidate;
}

function scan(symbols: string[]): LiveEnrichmentResult {
  return {
    scan_mode: "market-wide-live-options-v2",
    snapshot_candidates_reviewed: 0,
    intraday_candidates_reviewed: 0,
    live_eligible_count: symbols.length,
    news_candidates_reviewed: 0,
    options_candidates_reviewed: 0,
    live_data_as_of: NOW.toISOString(),
    market_session: "regular",
    unavailable_capabilities: [],
    stage_scope: {
      snapshot_attempts: 25,
      intraday_attempts: 10,
      news_attempts: 5,
      options_attempts: 2,
      description: "test",
    },
    quote_fallback_used: true,
    candidates: symbols.map(candidate),
  };
}

function installDataMock(sessionCount = 450) {
  massiveGetMock.mockImplementation((path: string) => {
    if (String(path).includes("/v2/reference/news")) return Promise.resolve({ results: [] });
    const symbol = String(path).split("/")[3] ?? "X";
    const seed = symbol.length * 17 + symbol.charCodeAt(0);
    return Promise.resolve(barsPayload(sessionCount, 50 + (seed % 100)));
  });
}

beforeEach(() => {
  massiveGetMock.mockReset();
  resetProjectionCaches();
});

describe("computeTickerProjection result shape", () => {
  it("labels the mode, request_mode, and rank meaning correctly", async () => {
    installDataMock();
    const result = await computeTickerProjection([subject("SSPC")], "key", false, NOW);
    expect(result.projection_mode).toBe("trend-news-analogue-ticker-v1");
    expect(result.request_mode).toBe("direct_ticker");
    expect(result.rank_meaning).toBe("request_order");
    expect(result.requested_symbols).toEqual(["SSPC"]);
    expect(result.cached).toBe(false);
    expect(result.cache_seconds).toBe(PROJECTION_CACHE_SECONDS);
    expect(result.method_notes.join(" ")).toMatch(/request(ed)? in|request order/i);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.symbol).toBe("SSPC");
    expect(result.candidates[0]!.projection_status).toBe("available");
    expect(getLastTickerProjection()).toBe(result);
  });

  it("assigns rank by request order, not alphabetically or by market rank", async () => {
    installDataMock();
    const result = await computeTickerProjection(
      [subject("ZZZ"), subject("AAA"), subject("MMM")],
      "key",
      false,
      NOW,
    );
    expect(result.candidates.map((c) => c.symbol)).toEqual(["ZZZ", "AAA", "MMM"]);
    expect(result.candidates.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it("caps the subjects at five", async () => {
    installDataMock();
    const subjects = ["A1", "B1", "C1", "D1", "E1", "F1"].map((s) => subject(s));
    const result = await computeTickerProjection(subjects, "key", false, NOW);
    expect(result.candidates).toHaveLength(5);
    expect(result.requested_symbols).toHaveLength(5);
  });

  it("projects with no live quote by anchoring to the latest completed close", async () => {
    installDataMock();
    const result = await computeTickerProjection([subject("NOQ", false)], "key", false, NOW);
    const projection = result.candidates[0]!;
    expect(projection.projection_status).toBe("available");
    expect(projection.anchor_price_source).toBe("latest_completed_close");
  });
});

describe("computeTickerProjection cache", () => {
  it("serves cached results within 15 minutes and marks them cached", async () => {
    installDataMock();
    const first = await computeTickerProjection([subject("SSPC")], "key", false, NOW);
    expect(first.cached).toBe(false);
    const calls = massiveGetMock.mock.calls.length;
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const second = await computeTickerProjection([subject("SSPC")], "key", false, later);
    expect(second.cached).toBe(true);
    expect(massiveGetMock.mock.calls.length).toBe(calls);
  });

  it("treats symbol order as the same cache entry but different symbols as different", async () => {
    installDataMock();
    await computeTickerProjection([subject("AAA"), subject("BBB")], "key", false, NOW);
    const calls = massiveGetMock.mock.calls.length;
    const reordered = await computeTickerProjection([subject("BBB"), subject("AAA")], "key", false, NOW);
    expect(reordered.cached).toBe(true);
    expect(massiveGetMock.mock.calls.length).toBe(calls);
    // Cache hits must still honor THIS request's order and re-rank accordingly.
    expect(reordered.requested_symbols).toEqual(["BBB", "AAA"]);
    expect(reordered.candidates.map((c) => c.symbol)).toEqual(["BBB", "AAA"]);
    expect(reordered.candidates.map((c) => c.rank)).toEqual([1, 2]);
    const different = await computeTickerProjection([subject("CCC")], "key", false, NOW);
    expect(different.cached).toBe(false);
    expect(massiveGetMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("recomputes after expiry and on force_refresh", async () => {
    installDataMock();
    await computeTickerProjection([subject("SSPC")], "key", false, NOW);
    const calls = massiveGetMock.mock.calls.length;
    const forced = await computeTickerProjection([subject("SSPC")], "key", true, NOW);
    expect(forced.cached).toBe(false);
    expect(massiveGetMock.mock.calls.length).toBeGreaterThan(calls);

    const expired = new Date(NOW.getTime() + (PROJECTION_CACHE_SECONDS + 1) * 1_000);
    const after = await computeTickerProjection([subject("SSPC")], "key", false, expired);
    expect(after.cached).toBe(false);
  });

  it("coalesces identical concurrent non-forced requests", async () => {
    installDataMock();
    const [a, b] = await Promise.all([
      computeTickerProjection([subject("SSPC")], "key", false, NOW),
      computeTickerProjection([subject("SSPC")], "key", false, NOW),
    ]);
    expect(a).toBe(b);
  });

  it("keeps the direct-ticker cache separate from the top-five scanner cache", async () => {
    installDataMock();
    const scanResult = await computeMarketProjection(scan(["SSPC"]), "scan-key", false, NOW);
    expect(scanResult.cached).toBe(false);
    // Same symbol via direct ticker must compute fresh (its own cache), and
    // vice versa: neither call may serve the other's cached result.
    const direct = await computeTickerProjection([subject("SSPC")], "key", false, NOW);
    expect(direct.cached).toBe(false);
    expect(direct.projection_mode).toBe("trend-news-analogue-ticker-v1");
    const scanAgain = await computeMarketProjection(scan(["SSPC"]), "scan-key", false, NOW);
    expect(scanAgain.cached).toBe(true);
    expect(scanAgain.projection_mode).toBe("trend-news-analogue-v1");
  });
});

describe("computeTickerProjection honesty", () => {
  it("refuses with an explicit reason when history is too short", async () => {
    massiveGetMock.mockImplementation((path: string) => {
      if (String(path).includes("/v2/reference/news")) return Promise.resolve({ results: [] });
      if (["SPY", "QQQ", "IWM"].some((b) => String(path).includes(`/${b}/`))) {
        return Promise.resolve(barsPayload(450, 400));
      }
      return Promise.resolve(barsPayload(50, 100));
    });
    const result = await computeTickerProjection([subject("NEWIPO")], "key", false, NOW);
    const projection = result.candidates[0]!;
    expect(projection.projection_status).toBe("unavailable");
    expect(projection.unavailable_reason).toMatch(/50 completed daily sessions/);
  });

  it("isolates a failing symbol without breaking the others", async () => {
    massiveGetMock.mockImplementation((path: string) => {
      if (String(path).includes("/v2/reference/news")) return Promise.resolve({ results: [] });
      if (String(path).includes("/BAD/")) return Promise.reject(new Error("boom"));
      const symbol = String(path).split("/")[3] ?? "X";
      return Promise.resolve(barsPayload(450, 50 + (symbol.length % 100)));
    });
    const result = await computeTickerProjection([subject("GOOD"), subject("BAD")], "key", false, NOW);
    expect(result.candidates[0]!.projection_status).toBe("available");
    expect(result.candidates[1]!.projection_status).toBe("unavailable");
  });
});
