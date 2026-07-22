/**
 * Shared deterministic helpers for "Project Any Ticker":
 *  - strict request-symbol validation for the owner-only ticker-projection API
 *  - natural-language projection-intent detection used to decide when an
 *    assistant chat message should attach server-computed ticker projections.
 *
 * The frontend mirrors this logic (ai-assistant.js); keep the two in sync.
 */

/** Accepts normal U.S. equity symbols, including class shares (BRK.B) and hyphens. */
export const TICKER_SYMBOL_PATTERN = /^[A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?$/;

export const MAX_PROJECTION_SYMBOLS = 5;

export interface SymbolValidation {
  ok: boolean;
  symbols: string[];
  error: string | null;
}

/**
 * Validate a client-supplied symbols value: must be an array (or comma/space
 * separated string) of 1-5 well-formed ticker symbols. Uppercases, trims,
 * and dedupes while preserving request order. Never accepts prose.
 */
export function sanitizeRequestedTickerSymbols(value: unknown): SymbolValidation {
  let rawList: string[];
  if (Array.isArray(value)) {
    rawList = value.map((v) => String(v ?? ""));
  } else if (typeof value === "string") {
    rawList = value.split(/[\s,;]+/);
  } else {
    return { ok: false, symbols: [], error: "symbols must be an array of 1-5 ticker symbols" };
  }
  const cleaned: string[] = [];
  for (const raw of rawList) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) continue;
    if (!TICKER_SYMBOL_PATTERN.test(symbol)) {
      return { ok: false, symbols: [], error: `"${raw.trim().slice(0, 30)}" is not a valid ticker symbol` };
    }
    if (!cleaned.includes(symbol)) cleaned.push(symbol);
  }
  if (!cleaned.length) {
    return { ok: false, symbols: [], error: "Provide at least one ticker symbol" };
  }
  if (cleaned.length > MAX_PROJECTION_SYMBOLS) {
    return {
      ok: false,
      symbols: [],
      error: `A maximum of ${MAX_PROJECTION_SYMBOLS} ticker symbols per request is supported (got ${cleaned.length})`,
    };
  }
  return { ok: true, symbols: cleaned, error: null };
}

/** Phrases that signal the user wants a forward-looking projection. */
const PROJECTION_PHRASES = [
  "project",
  "projection",
  "forecast",
  "price target",
  "price prediction",
  "predict",
  "outlook",
  "next week",
  "next month",
  "next day",
  "tomorrow",
  "coming week",
  "coming month",
  "coming days",
  "next few days",
  "next 5 days",
  "next five days",
  "next 20 days",
  "where will",
  "where is it headed",
  "where it's headed",
  "where its headed",
  "how high",
  "how low",
  "upside",
  "downside",
  "expected move",
  "scenario",
  "bear case",
  "bull case",
  "base case",
];

/**
 * Uppercase words that look like tickers but are almost always English words
 * in an assistant question. Only applies to bare uppercase tokens — cashtags
 * ($SSPC) always count.
 */
const UPPERCASE_STOPWORDS = new Set([
  "A", "I", "AI", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BUT", "BUY", "CAN", "CEO", "CFO",
  "DO", "DOES", "EPS", "ETF", "ETFS", "FAQ", "FOR", "FROM", "GDP", "GO", "HAS", "HOW", "IF", "IN",
  "IPO", "IRA", "IS", "IT", "ITS", "LLC", "LOW", "ME", "MY", "NEW", "NO", "NOT", "NOW", "OF", "OK",
  "ON", "OR", "P/E", "PE", "PM", "SEC", "SELL", "SO", "THE", "TO", "UP", "US", "USA", "USD", "VS",
  "WEEK", "WHAT", "WHEN", "WHO", "WHY", "WILL", "YOY", "YTD",
]);

export interface ProjectionIntent {
  intent: boolean;
  symbols: string[];
}

/**
 * Deterministic natural-language detection: returns intent=true plus up to
 * five symbols when the message asks for a forward-looking projection of
 * identifiable tickers. knownSymbols (watchlist + holdings) let plain-word
 * mentions like "sspc" resolve; bare uppercase tokens are filtered through a
 * stopword list; cashtags always count.
 */
export function detectProjectionIntent(message: string, knownSymbols: string[] = []): ProjectionIntent {
  const text = String(message ?? "");
  const lower = text.toLowerCase();
  const hasPhrase = PROJECTION_PHRASES.some((phrase) => lower.includes(phrase));
  if (!hasPhrase) return { intent: false, symbols: [] };

  const known = new Set(
    knownSymbols
      .map((s) => String(s ?? "").trim().toUpperCase())
      .filter((s) => TICKER_SYMBOL_PATTERN.test(s)),
  );

  const symbols: string[] = [];
  const add = (raw: string) => {
    const symbol = raw.toUpperCase();
    if (!TICKER_SYMBOL_PATTERN.test(symbol)) return;
    if (!symbols.includes(symbol)) symbols.push(symbol);
  };

  // 1) Cashtags: $SSPC always count.
  for (const match of text.matchAll(/\$([A-Za-z]{1,6}(?:[.-][A-Za-z0-9]{1,4})?)\b/g)) {
    add(match[1]!);
  }
  // 2) Bare uppercase tokens, filtered through stopwords.
  for (const match of text.matchAll(/\b([A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?)\b/g)) {
    const token = match[1]!;
    if (UPPERCASE_STOPWORDS.has(token)) continue;
    if (token.length === 1 && !known.has(token)) continue;
    add(token);
  }
  // 3) Any-case mentions of known watchlist/holding symbols.
  if (known.size) {
    for (const match of text.matchAll(/\b([A-Za-z]{1,6}(?:[.-][A-Za-z0-9]{1,4})?)\b/g)) {
      const token = match[1]!.toUpperCase();
      if (known.has(token)) add(token);
    }
  }

  const limited = symbols.slice(0, MAX_PROJECTION_SYMBOLS);
  return { intent: limited.length > 0, symbols: limited };
}
