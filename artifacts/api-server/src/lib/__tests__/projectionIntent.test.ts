import { describe, expect, it } from "vitest";

import {
  detectProjectionIntent,
  sanitizeRequestedTickerSymbols,
  MAX_PROJECTION_SYMBOLS,
} from "../projectionIntent.js";

describe("sanitizeRequestedTickerSymbols", () => {
  it("accepts a single valid symbol and uppercases it", () => {
    const result = sanitizeRequestedTickerSymbols(["sspc"]);
    expect(result.ok).toBe(true);
    expect(result.symbols).toEqual(["SSPC"]);
  });

  it("accepts up to five symbols, dedupes, and preserves request order", () => {
    const result = sanitizeRequestedTickerSymbols(["ZM", "aapl", "ZM", "BRK.B", "BF-B"]);
    expect(result.ok).toBe(true);
    expect(result.symbols).toEqual(["ZM", "AAPL", "BRK.B", "BF-B"]);
  });

  it("accepts a comma/space separated string", () => {
    const result = sanitizeRequestedTickerSymbols("SSPC, AAPL msft");
    expect(result.ok).toBe(true);
    expect(result.symbols).toEqual(["SSPC", "AAPL", "MSFT"]);
  });

  it("rejects more than five symbols with a clear error", () => {
    const result = sanitizeRequestedTickerSymbols(["AAX", "BBX", "CCX", "DDX", "EEX", "FFX"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(new RegExp(`maximum of ${MAX_PROJECTION_SYMBOLS}`));
  });

  it("rejects prose, injections, and malformed symbols", () => {
    for (const bad of [
      ["project apple for me please"],
      ["AAPL; DROP TABLE users"],
      ["<script>"],
      ["TOOLONGSYM"],
      ["123"],
      [""],
      [],
      "  ",
      42,
      null,
      undefined,
      { symbols: ["AAPL"] },
    ]) {
      const result = sanitizeRequestedTickerSymbols(bad as unknown);
      expect(result.ok).toBe(false);
      expect(result.symbols).toEqual([]);
      expect(result.error).toBeTruthy();
    }
  });
});

describe("detectProjectionIntent", () => {
  it("detects cashtags with a projection phrase", () => {
    const result = detectProjectionIntent("Can you project $SSPC for next week?");
    expect(result.intent).toBe(true);
    expect(result.symbols).toEqual(["SSPC"]);
  });

  it("detects bare uppercase tickers while filtering stopwords", () => {
    const result = detectProjectionIntent("WHAT IS the outlook for AAPL and NVDA next week? I WILL wait.");
    expect(result.intent).toBe(true);
    expect(result.symbols).toEqual(["AAPL", "NVDA"]);
  });

  it("resolves lowercase mentions of watchlist/holdings symbols", () => {
    const result = detectProjectionIntent("where will sspc be next week?", ["SSPC", "TSLA"]);
    expect(result.intent).toBe(true);
    expect(result.symbols).toEqual(["SSPC"]);
  });

  it("returns no intent without a projection phrase even when tickers appear", () => {
    const result = detectProjectionIntent("Tell me about AAPL earnings history.");
    expect(result.intent).toBe(false);
    expect(result.symbols).toEqual([]);
  });

  it("returns no intent when a projection phrase has no identifiable ticker", () => {
    const result = detectProjectionIntent("What is your forecast for the market next week?");
    expect(result.intent).toBe(false);
    expect(result.symbols).toEqual([]);
  });

  it("caps detection at five symbols", () => {
    const result = detectProjectionIntent(
      "Project AAX, BBX, CCX, DDX, EEX, FFX for next week",
    );
    expect(result.intent).toBe(true);
    expect(result.symbols).toHaveLength(5);
    expect(result.symbols).toEqual(["AAX", "BBX", "CCX", "DDX", "EEX"]);
  });

  it("does not treat single letters as tickers unless they are known symbols", () => {
    const noKnown = detectProjectionIntent("Project the upside, I think it doubles");
    expect(noKnown.intent).toBe(false);
    const known = detectProjectionIntent("what's the outlook for F next week?", ["F"]);
    expect(known.intent).toBe(true);
    expect(known.symbols).toEqual(["F"]);
  });
});
