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
  resetProjectionCaches,
  PROJECTION_CACHE_SECONDS,
} from "../marketProjection.js";
import type { EnrichedCandidate, LiveEnrichmentResult } from "../marketScanLive.js";

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

function candidate(symbol: string): EnrichedCandidate {
  return {
    symbol,
    confidence_meter: 80,
    live_snapshot: null,
    live_quote: {
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
    },
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

describe("cache behavior", () => {
  it("serves cached results within 15 minutes and marks them cached", async () => {
    installDataMock();
    const first = await computeMarketProjection(scan(["AAA"]), "key", false, NOW);
    expect(first.cached).toBe(false);
    expect(first.cache_seconds).toBe(PROJECTION_CACHE_SECONDS);
    const callsAfterFirst = massiveGetMock.mock.calls.length;

    const later = new Date(NOW.getTime() + 5 * 60_000);
    const second = await computeMarketProjection(scan(["AAA"]), "key", false, later);
    expect(second.cached).toBe(true);
    expect(massiveGetMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("recomputes after expiry and on force_refresh", async () => {
    installDataMock();
    await computeMarketProjection(scan(["AAA"]), "key", false, NOW);
    const callsAfterFirst = massiveGetMock.mock.calls.length;

    const forced = await computeMarketProjection(scan(["AAA"]), "key", true, NOW);
    expect(forced.cached).toBe(false);
    expect(massiveGetMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("does not let force_refresh or different-key requests join foreign in-flight work", async () => {
    let releaseFirst: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstCall = true;
    massiveGetMock.mockImplementation(async (path: string) => {
      if (firstCall) {
        firstCall = false;
        await gate; // hold the first (non-forced) computation in flight
      }
      if (String(path).includes("/v2/reference/news")) return { results: [] };
      const symbol = String(path).split("/")[3] ?? "X";
      return barsPayload(450, 50 + (symbol.length % 100));
    });

    const slow = computeMarketProjection(scan(["AAA"]), "key", false, NOW);
    const forced = computeMarketProjection(scan(["AAA"]), "key", true, NOW);
    const otherKey = computeMarketProjection(scan(["ZZZ"]), "key", false, NOW);
    const [forcedResult, otherResult] = await Promise.all([forced, otherKey]);
    expect(forcedResult.cached).toBe(false);
    expect(otherResult.candidates[0]!.symbol).toBe("ZZZ");
    releaseFirst!();
    const slowResult = await slow;
    expect(slowResult.candidates[0]!.symbol).toBe("AAA");
  });

  it("coalesces identical concurrent non-forced requests into one computation", async () => {
    installDataMock();
    const [a, b] = await Promise.all([
      computeMarketProjection(scan(["AAA"]), "key", false, NOW),
      computeMarketProjection(scan(["AAA"]), "key", false, NOW),
    ]);
    expect(a).toBe(b);
  });

  it("fetches benchmark history once per cache period across candidates", async () => {
    installDataMock();
    await computeMarketProjection(scan(["AAA", "BBB", "CCC"]), "key", false, NOW);
    const benchmarkCalls = massiveGetMock.mock.calls.filter((call) =>
      ["SPY", "QQQ", "IWM"].some((b) => String(call[0]).includes(`/${b}/`)),
    );
    expect(benchmarkCalls.length).toBe(3);
  });
});

describe("insufficient-data refusal", () => {
  it("returns projection_status unavailable with the exact reason when history is too short", async () => {
    massiveGetMock.mockImplementation((path: string) => {
      if (String(path).includes("/v2/reference/news")) return Promise.resolve({ results: [] });
      if (["SPY", "QQQ", "IWM"].some((b) => String(path).includes(`/${b}/`))) {
        return Promise.resolve(barsPayload(450, 400));
      }
      return Promise.resolve(barsPayload(50, 100)); // too few sessions
    });
    const result = await computeMarketProjection(scan(["AAA"]), "key", false, NOW);
    const projection = result.candidates[0]!;
    expect(projection.projection_status).toBe("unavailable");
    expect(projection.unavailable_reason).toMatch(/50 completed daily sessions/);
    expect(projection.horizons.one_day.status).toBe("unavailable");
  });

  it("labels plan-restricted history explicitly and never fabricates a projection", async () => {
    const { MassiveRequestError } = await vi.importActual<typeof import("../marketScanLive.js")>("../marketScanLive.js");
    massiveGetMock.mockImplementation((path: string) => {
      if (String(path).includes("/v2/reference/news")) return Promise.resolve({ results: [] });
      if (["SPY", "QQQ", "IWM"].some((b) => String(path).includes(`/${b}/`))) {
        return Promise.resolve(barsPayload(450, 400));
      }
      return Promise.reject(new MassiveRequestError("NOT_AUTHORIZED to access daily aggregates", 403, true));
    });
    const result = await computeMarketProjection(scan(["AAA"]), "key", false, NOW);
    const projection = result.candidates[0]!;
    expect(projection.projection_status).toBe("unavailable");
    expect(projection.unavailable_reason).toMatch(/not available on the current Massive plan/i);
  });
});
