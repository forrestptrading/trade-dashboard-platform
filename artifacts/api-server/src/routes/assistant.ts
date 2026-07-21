import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getBroker } from "../broker/index";
import { logger } from "../lib/logger";
import { getLastEnrichedScan } from "../lib/marketScanLive";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_ITEMS = 8;
const MAX_SYMBOLS = 12;
const MAX_HOLDINGS = 30;
const MAX_OUTPUT_TOKENS = 2_500;
const OPENAI_TIMEOUT_MS = 90_000;
const BENCHMARK_SYMBOLS = ["SPY", "QQQ", "IWM"] as const;
const WIDE_SPREAD_PERCENT = 0.5;
const CURRENT_QUOTE_SECONDS = 120;
const STALE_QUOTE_SECONDS = 600;

type JsonObject = Record<string, unknown>;
type ConversationItem = { role: "user" | "assistant"; content: string };
type MarketSession = "regular" | "pre-market" | "after-hours" | "closed" | "unknown";
type QuoteFreshness = "current" | "aging" | "stale" | "unknown";
type QuoteQuality = "clean" | "caution" | "unreliable";

type NormalizedQuote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  timestamp: string | null;
};

type MarketClock = {
  session: MarketSession;
  eastern_time: string;
  scheduled_market_day: boolean;
  holiday_calendar_checked: false;
  note: string;
};

type AnalyzedQuote = NormalizedQuote & {
  ageSeconds: number | null;
  freshness: QuoteFreshness;
  spread: number | null;
  spreadPercent: number | null;
  lastWithinBidAsk: boolean | null;
  quoteQuality: QuoteQuality;
  qualityFlags: string[];
  usableForDirectionalContext: boolean;
  eligibleForEntryLevels: boolean;
};

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ownerEmail(): string {
  return process.env["DASHBOARD_OWNER_EMAIL"]?.trim().toLowerCase() ?? "";
}

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const owner = ownerEmail();
  if (!owner) {
    res.status(503).json({
      success: false,
      error: "DASHBOARD_OWNER_EMAIL is not configured",
    });
    return;
  }

  if (req.user?.email.toLowerCase() !== owner) {
    res.status(403).json({
      success: false,
      error: "Dashboard owner access required",
    });
    return;
  }

  next();
}

function configured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]?.trim());
}

function modelName(): string {
  return process.env["OPENAI_MODEL"]?.trim() || DEFAULT_MODEL;
}

function sanitizeSymbols(value: unknown): string[] {
  return [...new Set(
    asArray(value)
      .map((item) => text(item, 12).toUpperCase())
      .filter((symbol) => /^[A-Z0-9.-]{1,12}$/.test(symbol)),
  )].slice(0, MAX_SYMBOLS);
}

function buildContextSymbols(requestedSymbols: string[]): string[] {
  const benchmarks = new Set<string>(BENCHMARK_SYMBOLS);
  const userSymbols = requestedSymbols
    .filter((symbol) => !benchmarks.has(symbol))
    .slice(0, MAX_SYMBOLS - BENCHMARK_SYMBOLS.length);
  return [...new Set([...userSymbols, ...BENCHMARK_SYMBOLS])];
}

function sanitizeHistory(value: unknown): ConversationItem[] {
  return asArray(value)
    .map((item) => {
      const object = asRecord(item);
      const role = object["role"];
      const content = text(object["content"], 1_500);
      if ((role !== "user" && role !== "assistant") || !content) return null;
      return { role, content } as ConversationItem;
    })
    .filter((item): item is ConversationItem => Boolean(item))
    .slice(-MAX_HISTORY_ITEMS);
}

function sanitizePortfolio(value: unknown): JsonObject {
  const portfolio = asRecord(value);
  const holdings = asArray(portfolio["holdings"])
    .map((item) => {
      const holding = asRecord(item);
      const symbol = text(holding["symbol"], 40).toUpperCase();
      if (!symbol) return null;
      return {
        symbol,
        quantity: optionalNumber(holding["quantity"]),
        current_price: optionalNumber(holding["current_price"]),
        average_price: optionalNumber(holding["average_price"]),
        market_value: optionalNumber(holding["market_value"]),
        asset_type: text(holding["asset_type"], 40) || null,
        account_name: text(holding["account_name"], 80) || null,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_HOLDINGS);

  return {
    total_value: optionalNumber(portfolio["total_value"]),
    cash: optionalNumber(portfolio["cash"]),
    buying_power: optionalNumber(portfolio["buying_power"]),
    invested_value: optionalNumber(portfolio["invested_value"]),
    day_change: optionalNumber(portfolio["day_change"]),
    day_change_percent: optionalNumber(portfolio["day_change_percent"]),
    data_as_of: text(portfolio["data_as_of"], 80) || null,
    retrieved_at: text(portfolio["retrieved_at"], 80) || null,
    holdings,
  };
}

function getEasternClock(now: Date): MarketClock {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = Number(values["hour"]);
    const minute = Number(values["minute"]);
    const weekday = values["weekday"] || "";
    const minuteOfDay = hour * 60 + minute;
    const scheduledMarketDay = !["Sat", "Sun"].includes(weekday);
    let session: MarketSession = "closed";

    if (scheduledMarketDay) {
      if (minuteOfDay >= 240 && minuteOfDay < 570) session = "pre-market";
      else if (minuteOfDay >= 570 && minuteOfDay < 960) session = "regular";
      else if (minuteOfDay >= 960 && minuteOfDay < 1_200) session = "after-hours";
    }

    return {
      session,
      eastern_time: `${values["year"]}-${values["month"]}-${values["day"]}T${values["hour"]}:${values["minute"]}:${values["second"]} America/New_York`,
      scheduled_market_day: scheduledMarketDay,
      holiday_calendar_checked: false,
      note: "Session is based on weekday and Eastern clock only. Exchange holidays, early closes, and trading halts are not verified.",
    };
  } catch {
    return {
      session: "unknown",
      eastern_time: now.toISOString(),
      scheduled_market_day: false,
      holiday_calendar_checked: false,
      note: "Market session could not be classified. Treat every setup as unconfirmed.",
    };
  }
}

async function fetchQuotes(symbols: string[]): Promise<NormalizedQuote[]> {
  if (!symbols.length) return [];
  const broker = getBroker();
  const liveQuotes = await broker.getQuotes(symbols);

  return liveQuotes
    .map((quote) => {
      const price = Number(quote.last_trade_price);
      const previousClose = Number(quote.previous_close);
      if (!quote.symbol || !Number.isFinite(price)) return null;
      const change = Number.isFinite(previousClose) ? price - previousClose : null;
      return {
        symbol: quote.symbol.toUpperCase(),
        price,
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
        change,
        changePercent:
          change !== null && previousClose !== 0
            ? (change / previousClose) * 100
            : null,
        bidPrice: Number.isFinite(Number(quote.bid_price))
          ? Number(quote.bid_price)
          : null,
        askPrice: Number.isFinite(Number(quote.ask_price))
          ? Number(quote.ask_price)
          : null,
        timestamp: quote.updated_at || null,
      };
    })
    .filter((quote): quote is NormalizedQuote => Boolean(quote));
}

function analyzeQuote(
  quote: NormalizedQuote,
  generatedAt: Date,
  marketSession: MarketSession,
): AnalyzedQuote {
  const quoteTime = quote.timestamp ? new Date(quote.timestamp) : null;
  const ageSeconds = quoteTime && !Number.isNaN(quoteTime.getTime())
    ? Math.max(0, Math.round((generatedAt.getTime() - quoteTime.getTime()) / 1_000))
    : null;
  const freshness: QuoteFreshness = ageSeconds === null
    ? "unknown"
    : ageSeconds <= CURRENT_QUOTE_SECONDS
      ? "current"
      : ageSeconds <= STALE_QUOTE_SECONDS
        ? "aging"
        : "stale";

  const hasBidAsk = quote.bidPrice !== null && quote.askPrice !== null;
  const crossedBidAsk = hasBidAsk && quote.bidPrice! > quote.askPrice!;
  const spread = hasBidAsk && !crossedBidAsk
    ? Math.max(0, quote.askPrice! - quote.bidPrice!)
    : null;
  const midpoint = hasBidAsk && !crossedBidAsk
    ? (quote.askPrice! + quote.bidPrice!) / 2
    : null;
  const spreadPercent = spread !== null && midpoint && midpoint > 0
    ? (spread / midpoint) * 100
    : null;
  const lastWithinBidAsk = hasBidAsk && !crossedBidAsk
    ? quote.price >= quote.bidPrice! && quote.price <= quote.askPrice!
    : null;

  const qualityFlags: string[] = [];
  if (!quote.timestamp) qualityFlags.push("missing_timestamp");
  if (freshness === "stale") qualityFlags.push("stale_quote");
  if (!hasBidAsk) qualityFlags.push("missing_bid_ask");
  if (crossedBidAsk) qualityFlags.push("crossed_bid_ask");
  if (lastWithinBidAsk === false) qualityFlags.push("last_outside_bid_ask");
  if (spreadPercent !== null && spreadPercent > WIDE_SPREAD_PERCENT) {
    qualityFlags.push("wide_spread");
  }

  const unreliableFlags = new Set([
    "missing_timestamp",
    "stale_quote",
    "crossed_bid_ask",
  ]);
  const quoteQuality: QuoteQuality = qualityFlags.some((flag) => unreliableFlags.has(flag))
    ? "unreliable"
    : qualityFlags.length
      ? "caution"
      : "clean";
  const usableForDirectionalContext =
    freshness !== "stale" && quote.previousClose !== null && quote.changePercent !== null;
  const eligibleForEntryLevels =
    marketSession === "regular" &&
    freshness === "current" &&
    lastWithinBidAsk === true &&
    !crossedBidAsk &&
    spreadPercent !== null &&
    spreadPercent <= WIDE_SPREAD_PERCENT;

  return {
    ...quote,
    ageSeconds,
    freshness,
    spread,
    spreadPercent,
    lastWithinBidAsk,
    quoteQuality,
    qualityFlags,
    usableForDirectionalContext,
    eligibleForEntryLevels,
  };
}

function summarizeQuoteQuality(quotes: AnalyzedQuote[]): JsonObject {
  return {
    total: quotes.length,
    clean: quotes.filter((quote) => quote.quoteQuality === "clean").length,
    caution: quotes.filter((quote) => quote.quoteQuality === "caution").length,
    unreliable: quotes.filter((quote) => quote.quoteQuality === "unreliable").length,
    stale: quotes.filter((quote) => quote.freshness === "stale").length,
    last_outside_bid_ask: quotes.filter((quote) => quote.lastWithinBidAsk === false).length,
    entry_level_eligible: quotes.filter((quote) => quote.eligibleForEntryLevels).length,
  };
}

function extractResponseText(value: unknown): string {
  const response = asRecord(value);
  const parts: string[] = [];
  for (const itemValue of asArray(response["output"])) {
    const item = asRecord(itemValue);
    for (const contentValue of asArray(item["content"])) {
      const content = asRecord(contentValue);
      if (content["type"] === "output_text") {
        const output = text(content["text"], 20_000);
        if (output) parts.push(output);
      }
    }
  }
  return parts.join("\n").trim();
}

router.get(
  "/assistant/config",
  requireAuth,
  requireOwner,
  (_req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      success: true,
      configured: configured(),
      model: modelName(),
      read_only: true,
      accuracy_mode: "trade-readiness-v2",
    });
  },
);

router.post(
  "/assistant/chat",
  requireAuth,
  requireOwner,
  async (req, res) => {
    const apiKey = process.env["OPENAI_API_KEY"]?.trim();
    if (!apiKey) {
      res.status(503).json({
        success: false,
        error: "OPENAI_API_KEY is not configured in the API deployment",
      });
      return;
    }

    const body = asRecord(req.body);
    const message = text(body["message"], MAX_MESSAGE_LENGTH);
    if (!message) {
      res.status(400).json({ success: false, error: "A message is required" });
      return;
    }

    const requestedSymbols = sanitizeSymbols(body["symbols"]);
    const contextSymbols = buildContextSymbols(requestedSymbols);
    const history = sanitizeHistory(body["history"]);
    const portfolio = sanitizePortfolio(body["portfolio"]);
    const generatedAt = new Date();
    const marketClock = getEasternClock(generatedAt);

    // When the dashboard requests market-scan analysis, attach the exact
    // server-generated enriched candidate objects (never client-supplied).
    const includeMarketScan = body["include_market_scan"] === true;
    const enrichedScan = includeMarketScan ? getLastEnrichedScan() : null;
    const marketScanContext = enrichedScan
      ? {
          scan_mode: enrichedScan.scan_mode,
          market_session: enrichedScan.market_session,
          live_data_as_of: enrichedScan.live_data_as_of,
          unavailable_capabilities: enrichedScan.unavailable_capabilities,
          candidates: enrichedScan.candidates.slice(0, 5),
        }
      : null;
    const marketScanUnavailable = includeMarketScan && !enrichedScan;

    let rawQuotes: NormalizedQuote[] = [];
    let quoteError: string | null = null;
    try {
      rawQuotes = await fetchQuotes(contextSymbols);
    } catch (error) {
      quoteError = error instanceof Error ? error.message : "Live quote request failed";
      logger.warn({ err: quoteError }, "[assistant] live quote context unavailable");
    }

    const quotes = rawQuotes.map((quote) => analyzeQuote(quote, generatedAt, marketClock.session));
    const dashboardContext = {
      generated_at: generatedAt.toISOString(),
      market_clock: marketClock,
      quote_source: quotes.length ? "robinhood" : null,
      quote_status: quotes.length
        ? "Timestamped quote response received"
        : quoteError
          ? "Quote response unavailable"
          : "No symbols requested",
      requested_symbols: requestedSymbols,
      benchmark_symbols: BENCHMARK_SYMBOLS,
      quote_quality_summary: summarizeQuoteQuality(quotes),
      quotes,
      portfolio,
      market_scan: marketScanContext,
      market_scan_status: marketScanContext
        ? "Server-generated enriched market-scan candidates are attached under market_scan."
        : marketScanUnavailable
          ? "Market-scan analysis was requested, but no enriched scan is cached on the server. Run the full-market scan first."
          : "No market-scan context was requested.",
      unavailable_inputs: [
        "candlestick charts",
        "economic calendar",
        "order flow and time-and-sales",
        ...(marketScanContext
          ? []
          : [
              "intraday volume and relative volume",
              "news and earnings catalysts",
              "market-wide scanner",
              "options chains and premiums",
              "implied volatility and option Greeks",
            ]),
      ],
    };

    const instructions = [
      "You are the read-only trading research assistant inside Forrest's private dashboard.",
      "Use the supplied dashboard context as the only source for prices, balances, holdings, timestamps, and market-session classification.",
      "Never imply access to charts, candles, volume, order flow, news, earnings, economic events, option chains, option premiums, implied volatility, or Greeks unless those values are explicitly supplied.",
      "Always distinguish observed data from interpretation and state when evidence is insufficient.",
      "For any request involving a callout, trade idea, tomorrow's plan, entry, stop, target, or scanner, begin with a short Data Readiness section covering market session, timestamp freshness, bid-ask consistency, and major quality flags.",
      "Premarket, after-hours, closed-session, unknown-session, stale, crossed, or last-outside-bid-ask quotes may be used only as reference context. They cannot establish actionable entries, stops, targets, support, resistance, breakouts, breakdowns, or confirmed momentum.",
      "Do not treat a bid, ask, previous close, or after-hours print as a technical level. Do not invent candles, sustained prints, opening ranges, pivots, or chart structure.",
      "Use the label watch candidate unless the market session is regular and the relevant quote has eligibleForEntryLevels=true. Even then, every idea must remain conditional and require confirmation.",
      "When quote fields conflict, downgrade confidence or say no valid setup. Never repair conflicting values by guessing which field is correct.",
      "SPY, QQQ, and IWM are benchmark context. Do not present them as user watchlist selections unless they also appear in requested_symbols.",
      "Provide no more than two trade candidates unless the user explicitly requests more. It is acceptable and often preferable to return no valid setup.",
      "For each candidate include observed facts, bias or watch thesis, confirmation condition, invalidation condition, missing data, and confidence level. Do not provide exact entry, stop, or target prices from the current data alone.",
      "Respect portfolio constraints. Do not recommend share quantities whose cost exceeds reported buying power. Do not recommend short selling when margin and borrow availability are unknown. Do not recommend a specific option contract without a current option chain, premium, spread, expiration, implied volatility, and Greeks.",
      "For options already held, call out expiration risk, leverage, liquidity uncertainty, and maximum-loss uncertainty when cost basis is missing.",
      "When market_scan is present in the dashboard context, its candidates are exact server-generated objects. Analyze only the fields present. Never invent, estimate, or extrapolate live prices, VWAP, intraday levels, option premiums, spreads, open interest, implied volatility, Greeks, or news that is not in the supplied objects.",
      "All confidence scores, intraday setup scores, and option scores in market_scan are deterministic backend calculations. Do not recalculate, adjust, or re-score them; you may only compare and interpret them.",
      "If a market_scan candidate marks a field or capability as unavailable (for example options_chain_available=false or entries in unavailable_capabilities), state that limitation explicitly instead of filling the gap.",
      "Do not promise returns, guarantee outcomes, or claim certainty about future market direction.",
      "You cannot place, modify, approve, or cancel trades. Never imply that you performed an order action.",
      "Keep answers practical, structured, and concise.",
    ].join(" ");

    const input = [
      ...history,
      {
        role: "user" as const,
        content: `${message}\n\nDashboard context (JSON):\n${JSON.stringify(dashboardContext)}`,
      },
    ];

    try {
      const openAIResponse = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName(),
          instructions,
          input,
          reasoning: { effort: "low" },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
        }),
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      });

      const responseText = await openAIResponse.text();
      let responseData: unknown = null;
      if (responseText) {
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = responseText;
        }
      }

      if (!openAIResponse.ok) {
        const errorObject = asRecord(responseData);
        const nestedError = asRecord(errorObject["error"]);
        const detail = text(nestedError["message"], 300) || `HTTP ${openAIResponse.status}`;
        logger.warn(
          { status: openAIResponse.status, detail },
          "[assistant] OpenAI response failed",
        );
        res.status(502).json({
          success: false,
          error: "The AI assistant service is temporarily unavailable",
        });
        return;
      }

      const answer = extractResponseText(responseData);
      if (!answer) {
        const responseObject = asRecord(responseData);
        const incompleteDetails = asRecord(responseObject["incomplete_details"]);
        const reason = text(incompleteDetails["reason"], 120) || "no text output";
        throw new Error(`The AI service returned no text output (${reason})`);
      }

      const responseObject = asRecord(responseData);
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.json({
        success: true,
        data: {
          answer,
          response_id: text(responseObject["id"], 120) || null,
          model: text(responseObject["model"], 120) || modelName(),
          quote_count: quotes.length,
          quote_symbols: quotes.map((quote) => quote.symbol),
          generated_at: dashboardContext.generated_at,
          market_session: marketClock.session,
          quote_quality_summary: dashboardContext.quote_quality_summary,
          read_only: true,
          accuracy_mode: "trade-readiness-v2",
        },
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.warn({ err: messageText }, "[assistant] request failed");
      res.status(502).json({
        success: false,
        error: "The AI assistant service is temporarily unavailable",
      });
    }
  },
);

export default router;
