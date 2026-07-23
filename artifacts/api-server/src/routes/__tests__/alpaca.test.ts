import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const mockGetLatestAlpacaStockBar = vi.fn();
const mockGetAlpacaConfigCheck = vi.fn();

vi.mock("../../lib/alpacaMarketData.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/alpacaMarketData.js")>();
  return {
    ...actual,
    getAlpacaConfigCheck: mockGetAlpacaConfigCheck,
    getLatestAlpacaStockBar: mockGetLatestAlpacaStockBar,
  };
});

async function createServer() {
  const { default: router } = await import("../alpaca.js");
  const app = express();
  app.use("/api", router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

beforeEach(() => {
  vi.resetModules();
  mockGetLatestAlpacaStockBar.mockReset();
  mockGetAlpacaConfigCheck.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Alpaca routes", () => {
  it("returns only safe config-check fields", async () => {
    mockGetAlpacaConfigCheck.mockReturnValue({ success: true, keyIdConfigured: true, secretKeyConfigured: true, feed: "iex" });
    const { server, baseUrl } = await createServer();
    try {
      const res = await fetch(`${baseUrl}/api/alpaca/config-check`);
      const body = await res.json();
      expect(body).toEqual({ success: true, keyIdConfigured: true, secretKeyConfigured: true, feed: "iex" });
      expect(JSON.stringify(body)).not.toContain("secret-value");
    } finally {
      server.close();
    }
  });

  it("returns normalized data from the authenticated test endpoint", async () => {
    mockGetLatestAlpacaStockBar.mockResolvedValue({
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
    const { server, baseUrl } = await createServer();
    try {
      const res = await fetch(`${baseUrl}/api/alpaca/test?symbol=AAPL`);
      await expect(res.json()).resolves.toMatchObject({ success: true, data: { symbol: "AAPL", source: "alpaca" } });
      expect(mockGetLatestAlpacaStockBar).toHaveBeenCalledWith("AAPL");
    } finally {
      server.close();
    }
  });
});
