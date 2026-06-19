/**
 * Broker integration feature flag.
 *
 * Set USE_LIVE_DATA=true in Replit Secrets to enable live Robinhood calls.
 * Default is false — all routes serve mock data.
 *
 * Enable one route at a time by checking useLiveData() inside each handler.
 * The app never breaks if live data fails — routes always fall back to mock.
 */

export function useLiveData(): boolean {
  return process.env["USE_LIVE_DATA"] === "true";
}

/**
 * Read-only guard. Call this before any non-GET broker operation to ensure
 * write routes can never propagate to a real broker, even accidentally.
 */
export function assertReadOnly(context: string): void {
  if (useLiveData()) {
    throw new Error(
      `[broker] Write operation blocked in live mode — ${context}. ` +
        "Only read-only broker calls are permitted.",
    );
  }
}

export const BROKER_CONFIG = {
  baseUrl: "https://api.robinhood.com",
  clientId: "c82SH0WZOsabOXGP2sxqcj34FFK0GMd4", // Robinhood public web client_id
  tokenTtlSeconds: 86400, // 24 hours
  rateLimitMs: 500, // minimum ms between requests
} as const;
