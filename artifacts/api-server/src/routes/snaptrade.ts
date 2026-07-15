import { createHmac } from "node:crypto";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const SNAPTRADE_ORIGIN = "https://api.snaptrade.com";
const API_PREFIX = "/api/v1";
const DEFAULT_DASHBOARD_URL =
  "https://forrestptrading.github.io/trade-dashboard-platform/";

type JsonObject = Record<string, unknown>;

type SnapTradeRequestOptions = {
  method?: "GET" | "POST";
  body?: JsonObject;
};

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = asRecord(value);
  for (const key of ["data", "results", "accounts", "positions", "balances", "authorizations"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

function nested(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    const object = asRecord(current);
    if (!(key in object)) return undefined;
    current = object[key];
  }
  return current;
}

function firstText(values: unknown[], fallback = ""): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function firstNumber(values: unknown[], fallback = 0): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function configured(): boolean {
  return Boolean(
    process.env["SNAPTRADE_CLIENT_ID"]?.trim() &&
      process.env["SNAPTRADE_CONSUMER_KEY"]?.trim(),
  );
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

async function requestSnapTrade<T>(
  apiPath: string,
  options: SnapTradeRequestOptions = {},
): Promise<T> {
  const clientId = process.env["SNAPTRADE_CLIENT_ID"]?.trim();
  const consumerKey = process.env["SNAPTRADE_CONSUMER_KEY"]?.trim();
  if (!clientId || !consumerKey) {
    throw new Error("SnapTrade credentials are not configured");
  }

  const signedPath = `${API_PREFIX}${apiPath}`;
  const query = new URLSearchParams({
    clientId,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  }).toString();
  const content = options.body && Object.keys(options.body).length
    ? options.body
    : null;
  const signaturePayload = canonicalJson({
    content,
    path: signedPath,
    query,
  });
  const signature = createHmac("sha256", consumerKey)
    .update(signaturePayload, "utf8")
    .digest("base64");

  const response = await fetch(`${SNAPTRADE_ORIGIN}${signedPath}?${query}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      Signature: signature,
      ...(content ? { "Content-Type": "application/json" } : {}),
    },
    ...(content ? { body: JSON.stringify(content) } : {}),
  });

  const responseText = await response.text();
  let data: unknown = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }

  if (!response.ok) {
    const requestId = response.headers.get("X-Request-ID") ?? undefined;
    const detail = typeof data === "string"
      ? data.slice(0, 240)
      : firstText([
          asRecord(data)["detail"],
          asRecord(data)["message"],
          asRecord(data)["error"],
        ]);
    logger.warn(
      { status: response.status, requestId, apiPath, detail },
      "[snaptrade] request failed",
    );
    throw new Error(
      `SnapTrade request failed with HTTP ${response.status}${requestId ? ` (${requestId})` : ""}`,
    );
  }

  return data as T;
}

function positionSymbol(position: JsonObject): string {
  const instrument = asRecord(position["instrument"]);
  const symbolObject = asRecord(position["symbol"]);
  const nestedSymbol = asRecord(symbolObject["symbol"]);
  return firstText([
    instrument["symbol"],
    nested(instrument, ["symbol", "symbol"]),
    nestedSymbol["symbol"],
    symbolObject["symbol"],
    position["option_symbol"],
    position["ticker"],
    instrument["name"],
  ], "Unknown").toUpperCase();
}

function normalizePosition(
  positionValue: unknown,
  accountValue: unknown,
): JsonObject | null {
  const position = asRecord(positionValue);
  const account = asRecord(accountValue);
  const instrument = asRecord(position["instrument"]);
  const units = firstNumber([
    position["units"],
    position["quantity"],
    position["shares"],
    position["fractional_units"],
  ]);
  if (units === 0) return null;

  const price = firstNumber([
    nested(position, ["price", "amount"]),
    position["price"],
    position["current_price"],
    position["market_price"],
  ]);
  const multiplier = firstNumber([
    instrument["multiplier"],
    position["multiplier"],
  ], 1);
  const marketValue = firstNumber([
    nested(position, ["market_value", "amount"]),
    position["market_value"],
    position["value"],
  ], units * price * multiplier);
  const cashEquivalent = Boolean(
    position["cash_equivalent"] ?? instrument["cash_equivalent"],
  );

  return {
    symbol: positionSymbol(position),
    quantity: round(units, 8),
    current_price: price ? round(price, 8) : null,
    market_value: round(marketValue),
    average_price: firstNumber([
      nested(position, ["cost_basis", "amount"]),
      position["cost_basis"],
      position["average_purchase_price"],
      position["average_price"],
    ]) || null,
    asset_type: firstText([
      instrument["type"],
      instrument["kind"],
      position["type"],
      position["option_type"],
    ], "security"),
    option_symbol: firstText([position["option_symbol"]]) || null,
    cash_equivalent: cashEquivalent,
    account_id: firstText([account["id"]]),
    account_name: firstText([
      account["name"],
      account["institution_name"],
      nested(account, ["institution", "name"]),
    ], "Investment Account"),
  };
}

function currencyCode(balance: JsonObject): string {
  return firstText([
    nested(balance, ["currency", "code"]),
    balance["currency"],
  ]).toUpperCase();
}

function accountDataAsOf(
  account: JsonObject,
  positionPayload: unknown,
  balancePayload: unknown,
): string | null {
  return firstText([
    nested(positionPayload, ["data_freshness", "as_of"]),
    nested(balancePayload, ["data_freshness", "as_of"]),
    nested(account, ["sync_status", "holdings", "last_successful_sync"]),
    account["updated_at"],
  ]) || null;
}

function normalizeAccount(
  accountValue: unknown,
  balancePayload: unknown,
  positions: JsonObject[],
  dataAsOf: string | null,
): JsonObject {
  const account = asRecord(accountValue);
  const balances = asArray(balancePayload).map(asRecord);
  const usdBalances = balances.filter((balance) => {
    const code = currencyCode(balance);
    return !code || code === "USD";
  });
  const usableBalances = usdBalances.length ? usdBalances : balances;
  const cash = usableBalances.reduce(
    (sum, balance) => sum + firstNumber([
      nested(balance, ["cash", "amount"]),
      balance["cash"],
      balance["amount"],
    ]),
    0,
  );
  const buyingPower = usableBalances.reduce(
    (sum, balance) => sum + firstNumber([
      nested(balance, ["buying_power", "amount"]),
      balance["buying_power"],
      balance["buyingPower"],
    ]),
    0,
  );
  const investedValue = positions
    .filter((position) => !position["cash_equivalent"])
    .reduce((sum, position) => sum + firstNumber([position["market_value"]]), 0);
  const reportedTotal = firstNumber([
    nested(account, ["balance", "total", "amount"]),
    nested(account, ["balance", "total"]),
    account["total_value"],
    account["balance"],
  ]);

  return {
    id: firstText([account["id"]]),
    name: firstText([
      account["name"],
      account["institution_name"],
      nested(account, ["institution", "name"]),
    ], "Investment Account"),
    account_number: firstText([
      account["number"],
      account["account_number"],
    ]),
    status: firstText([account["status"]], "connected"),
    cash: round(cash),
    buying_power: round(buyingPower),
    invested_value: round(investedValue),
    total_value: round(reportedTotal || cash + investedValue),
    data_as_of: dataAsOf,
    sync_status: account["sync_status"] ?? null,
  };
}

function oldestTimestamp(values: Array<string | null>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (!valid.length) return null;
  return new Date(Math.min(...valid.map((value) => value.getTime()))).toISOString();
}

function freshnessLabel(dataAsOf: string | null): string {
  if (!dataAsOf) return "Timestamp unavailable";
  const ageMs = Date.now() - new Date(dataAsOf).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "Reported by SnapTrade";
  const ageHours = ageMs / 3_600_000;
  if (ageHours < 1) return "Less than 1 hour old";
  if (ageHours < 24) return `${Math.floor(ageHours)} hours old`;
  return `${Math.floor(ageHours / 24)} days old`;
}

router.use(requireAuth, requireOwner);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  next();
});

router.get("/snaptrade/config-check", (_req, res) => {
  res.json({
    success: true,
    configured: configured(),
    authentication_mode: "personal",
    client_id_present: Boolean(process.env["SNAPTRADE_CLIENT_ID"]?.trim()),
    consumer_key_present: Boolean(
      process.env["SNAPTRADE_CONSUMER_KEY"]?.trim(),
    ),
    owner_email_present: Boolean(ownerEmail()),
  });
});

router.post("/snaptrade/connect", async (_req, res) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: "SnapTrade is not configured" });
    return;
  }

  try {
    const data = asRecord(await requestSnapTrade<unknown>("/snapTrade/login", {
      method: "POST",
      body: {
        connectionType: "read",
        customRedirect:
          process.env["DASHBOARD_PUBLIC_URL"]?.trim() || DEFAULT_DASHBOARD_URL,
        immediateRedirect: true,
        showCloseButton: true,
        darkMode: true,
        connectionPortalVersion: "v4",
      },
    }));
    const redirectUri = firstText([
      data["redirectURI"],
      data["redirect_uri"],
      data["loginLink"],
    ]);
    if (!redirectUri) throw new Error("SnapTrade response omitted the connection link");
    res.json({ success: true, source: "snaptrade", redirect_uri: redirectUri });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[snaptrade] connection portal failed");
    res.status(502).json({ success: false, error: message });
  }
});

router.get("/snaptrade/connections", async (_req, res) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: "SnapTrade is not configured" });
    return;
  }

  try {
    const payload = await requestSnapTrade<unknown>("/authorizations");
    res.json({
      success: true,
      source: "snaptrade",
      data: asArray(payload),
      retrieved_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[snaptrade] connections failed");
    res.status(502).json({ success: false, error: message });
  }
});

router.get("/snaptrade/portfolio", async (_req, res) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: "SnapTrade is not configured" });
    return;
  }

  try {
    const accountPayload = await requestSnapTrade<unknown>("/accounts");
    const rawAccounts = asArray(accountPayload);
    const snapshots = await Promise.all(
      rawAccounts.map(async (accountValue) => {
        const account = asRecord(accountValue);
        const accountId = firstText([account["id"]]);
        if (!accountId) {
          return {
            accountValue,
            balancePayload: [],
            positionPayload: [],
            positions: [] as JsonObject[],
            dataAsOf: null as string | null,
          };
        }

        const [balanceResult, positionResult] = await Promise.allSettled([
          requestSnapTrade<unknown>(
            `/accounts/${encodeURIComponent(accountId)}/balances`,
          ),
          requestSnapTrade<unknown>(
            `/accounts/${encodeURIComponent(accountId)}/positions/all`,
          ),
        ]);
        const balancePayload = balanceResult.status === "fulfilled"
          ? balanceResult.value
          : [];
        const positionPayload = positionResult.status === "fulfilled"
          ? positionResult.value
          : [];
        const positions = asArray(positionPayload)
          .map((position) => normalizePosition(position, accountValue))
          .filter((position): position is JsonObject => Boolean(position));
        const dataAsOf = accountDataAsOf(
          account,
          positionPayload,
          balancePayload,
        );

        return {
          accountValue,
          balancePayload,
          positionPayload,
          positions,
          dataAsOf,
        };
      }),
    );

    const holdings = snapshots.flatMap((snapshot) => snapshot.positions);
    const accounts = snapshots.map((snapshot) =>
      normalizeAccount(
        snapshot.accountValue,
        snapshot.balancePayload,
        snapshot.positions,
        snapshot.dataAsOf,
      ),
    );
    const cash = accounts.reduce(
      (sum, account) => sum + firstNumber([account["cash"]]),
      0,
    );
    const buyingPower = accounts.reduce(
      (sum, account) => sum + firstNumber([account["buying_power"]]),
      0,
    );
    const investedValue = accounts.reduce(
      (sum, account) => sum + firstNumber([account["invested_value"]]),
      0,
    );
    const totalValue = accounts.reduce(
      (sum, account) => sum + firstNumber([account["total_value"]]),
      0,
    );
    const dataAsOf = oldestTimestamp(
      snapshots.map((snapshot) => snapshot.dataAsOf),
    );
    const retrievedAt = new Date().toISOString();

    res.json({
      success: true,
      source: "snaptrade",
      data: {
        source: "snaptrade",
        account_name: "SnapTrade Personal",
        total_value: round(totalValue || cash + investedValue),
        cash: round(cash),
        buying_power: round(buyingPower),
        invested_value: round(investedValue),
        day_change: null,
        day_change_percent: null,
        accounts,
        holdings,
        open_positions: holdings.filter(
          (holding) => !holding["cash_equivalent"],
        ).length,
        data_as_of: dataAsOf,
        freshness_label: freshnessLabel(dataAsOf),
        retrieved_at: retrievedAt,
        data_freshness: snapshots.map((snapshot, index) => ({
          account_id: accounts[index]?.["id"] ?? null,
          account_name: accounts[index]?.["name"] ?? "Investment Account",
          data_as_of: snapshot.dataAsOf,
          sync_status: asRecord(snapshot.accountValue)["sync_status"] ?? null,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "[snaptrade] portfolio failed");
    res.status(502).json({ success: false, error: message });
  }
});

export default router;
