import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlpacaMarketDataError,
  getAlpacaConfigCheck,
  getLatestAlpacaStockBar,
} from "../alpacaMarketData";

const ORIGINAL_ENV = { ...process.env };
const SECRET = "super-secret-alpaca-key";
const KEY_ID = "public-key-id";
const mockFetch = vi.fn<typeof fetch>();

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function configureCredentials(): void {
  process.env["ALPACA_API_KEY_ID"] = KEY_ID;
  process.env["ALPACA_API_SECRET_KEY"] = SECRET;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env["ALPACA_API_KEY_ID"];
  delete process.env["ALPACA_API_SECRET_KEY"];
  delete process.env["ALPACA_MARKET_DATA_FEED"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("Alpaca Market Data client", () => {
  it("reports missing credentials without exposing credential values", () => {
    process.env["ALPACA_API_KEY_ID"] = KEY_ID;

    expect(getAlpacaConfigCheck()).toEqual({
      success: true,
      keyIdConfigured: true,
      secretKeyConfigured: false,
      feed: "iex",
    });
    expect(JSON.stringify(getAlpacaConfigCheck())).not.toContain(KEY_ID);
  });

  it("rejects invalid ticker symbols before calling Alpaca", async () => {
    configureCredentials();

    await expect(getLatestAlpacaStockBar("AAP L")).rejects.toMatchObject({
      statusCode: 400,
      message: "A valid ticker symbol is required",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns a successful normalized latest bar response", async () => {
    configureCredentials();
    mockFetch.mockResolvedValueOnce(
      response(200, {
        bar: { t: "2026-07-23T14:30:00Z", o: 10, h: 11, l: 9, c: 10.5, v: 12345, n: 321, vw: 10.25 },
      }),
    );

    await expect(getLatestAlpacaStockBar("aapl")).resolves.toEqual({
      symbol: "AAPL",
      timestamp: "2026-07-23T14:30:00Z",
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 12345,
      tradeCount: 321,
      vwap: 10.25,
      feed: "iex",
      source: "alpaca",
    });

    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://data.alpaca.markets/v2/stocks/AAPL/bars/latest?feed=iex");
    expect(init?.headers).toMatchObject({
      "APCA-API-KEY-ID": KEY_ID,
      "APCA-API-SECRET-KEY": SECRET,
    });
  });

  it("maps invalid credentials/upstream 401 to a safe error", async () => {
    configureCredentials();
    mockFetch.mockResolvedValueOnce(response(401, { message: `bad ${SECRET}` }));

    let caught: unknown;
    try {
      await getLatestAlpacaStockBar("AAPL");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AlpacaMarketDataError);
    expect(caught).toMatchObject({
      statusCode: 401,
      upstreamStatus: 401,
      message: "Alpaca Market Data request was not authorized",
    });
    expect(String((caught as Error).message)).not.toContain(SECRET);
  });

  it("falls back to IEX once when SIP access returns 403", async () => {
    configureCredentials();
    process.env["ALPACA_MARKET_DATA_FEED"] = "sip";
    mockFetch
      .mockResolvedValueOnce(response(403, { message: `sip denied ${SECRET}` }))
      .mockResolvedValueOnce(response(200, { bar: { t: "2026-07-23T14:31:00Z", o: 1, h: 2, l: 1, c: 2, v: 100, n: 5, vw: 1.5 } }));

    await expect(getLatestAlpacaStockBar("MSFT")).resolves.toMatchObject({
      symbol: "MSFT",
      feed: "iex",
      fallbackUsed: "iex",
      source: "alpaca",
    });
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("feed=sip");
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("feed=iex");
  });

  it("does not leak credentials in safe responses or errors", async () => {
    configureCredentials();
    mockFetch.mockResolvedValueOnce(response(500, { key: KEY_ID, secret: SECRET }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(getLatestAlpacaStockBar("AAPL")).rejects.toMatchObject({
      statusCode: 502,
      message: "Alpaca Market Data request failed",
    });

    const safeOutput = JSON.stringify([getAlpacaConfigCheck(), consoleError.mock.calls, consoleWarn.mock.calls]);
    expect(safeOutput).not.toContain(KEY_ID);
    expect(safeOutput).not.toContain(SECRET);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
