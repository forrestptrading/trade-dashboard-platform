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

/**
 * Returns the bearer token from ROBINHOOD_ACCESS_TOKEN if set, or null.
 * The quotes endpoint is publicly accessible without auth, but including
 * a token provides better rate limits and more reliable uptime.
 *
 * Never log or expose this value. Never send it to the frontend.
 */
export function getOptionalAccessToken(): string | null {
  const token = process.env["ROBINHOOD_ACCESS_TOKEN"];
  return token && token.trim().length > 0 ? token.trim() : null;
}

/**
 * Build standard headers for Robinhood API requests.
 * Includes Authorization only when a token is available.
 */
export function buildRequestHeaders(): Record<string, string> {
  const token = getOptionalAccessToken();
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    // Use a realistic User-Agent to avoid basic bot detection
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}
