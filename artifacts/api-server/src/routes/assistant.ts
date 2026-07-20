import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getBroker } from "../broker/index";
import { logger } from "../lib/logger";
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

type JsonObject = Record<string, unknown>;
type ConversationItem = { role: "user" | "assistant"; content: string };

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
      const symbol = text(holding["symbol"], 20).toUpperCase();
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

    const symbols = sanitizeSymbols(body["symbols"]);
    const history = sanitizeHistory(body["history"]);
    const portfolio = sanitizePortfolio(body["portfolio"]);

    let quotes: NormalizedQuote[] = [];
    let quoteError: string | null = null;
    try {
      quotes = await fetchQuotes(symbols);
    } catch (error) {
      quoteError = error instanceof Error ? error.message : "Live quote request failed";
      logger.warn({ err: quoteError }, "[assistant] live quote context unavailable");
    }

    const dashboardContext = {
      generated_at: new Date().toISOString(),
      quote_source: quotes.length ? "robinhood" : null,
      quote_status: quotes.length
        ? "Live quote response received"
        : quoteError
          ? "Live quote response unavailable"
          : "No symbols requested",
      quotes,
      portfolio,
    };

    const instructions = [
      "You are the read-only trading research assistant inside Forrest's private dashboard.",
      "Use the supplied dashboard context as the only source for current prices, balances, holdings, and timestamps.",
      "Never claim a price is live when no timestamped quote was supplied.",
      "Clearly separate observed data from your interpretation.",
      "Do not promise returns, guarantee outcomes, or claim certainty about future market direction.",
      "For options, call out expiration risk, leverage, and maximum loss when relevant.",
      "You cannot place, modify, approve, or cancel trades. Never imply that you performed an order action.",
      "Keep answers practical and concise. State plainly when required data is unavailable.",
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
          read_only: true,
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
