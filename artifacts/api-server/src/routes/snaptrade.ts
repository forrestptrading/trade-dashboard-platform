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
const API_BASE = "https://api.snaptrade.com";
const DASHBOARD_URL =
  "https://forrestptrading.github.io/trade-dashboard-platform/";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pathValue(value: unknown, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const currentRecord = record(current);
    if (!(key in currentRecord)) return undefined;
    current = currentRecord[key];
  }
  return current;
}

function text(values: unknown[], fallback = ""): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function number(values: unknown[], fallback = 0): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function orderedJson(value: unknown): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  JSON.stringify(value, (key, nestedValue) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    return nestedValue;
  });
  keys.sort();
  return JSON.stringify(value, keys);
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

interface RequestOptions {
  method?: "GET" | "POST";
  body?: RecordValue;
}

async function requestSnapTrade<T>(
  apiPath: string,
  options: RequestOptions = {},
): Promise<T> {
  const clientId = process.env["SNAPTRADE_CLIENT_ID"]?.trim();
  const consumerKey = process.env["SNAPTRADE_CONSUMER_KEY"]?.trim();
  if (!clientId || !consumerKey) {
    throw new Error("SnapTrade credentials are not configured");
  }

  const query = new URLSearchParams({
    clientId,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  });
  const body = options.body && Object.keys(options.body).length
    ? options.body
    : null;
  const signature = createHmac("sha256", encodeURI(consumerKey))
    .update(
      orderedJson({
        content: body,
        path: apiPath,
        query: query.toString(),
      }),
    )
    .digest("base64");

  const response = await fetch(`${API_BASE}${apiPath}?${query.toString()}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      Signature: signature,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
    throw new Error(`SnapTrade HTTP ${response.status}`);
  }
  return data as T;
}

function normalizePosition(
  positionValue: unknown,
  accountValue: unknown,
): RecordValue | null {
  const position = record(positionValue);
  const account = record(accountValue);
  const instrument = record(position["instrument"]);
  const symbol = text([
    instrument["symbol"],
    pathValue(position, ["symbol", "symbol", "symbol"]),
    pathValue(position, ["symbol", "symbol"]),
    position["ticker"],
  ]).toUpperCase();
  const quantity = number([
    position["units"],
    position["quantity"],
    position["shares"],
    position["fractional_units"],
  ]);
  if (!symbol || quantity === 0) return null;

  const price = number([
    position["price"],
    position["current_price"],
    position["market_price"],
  ]);
  const multiplier = number([instrument["multiplier"]], 1);
  const marketValue = number(
    [position["market_value"], position["value"]],
    quantity * price * multiplier,
  );

  return {
    symbol,
    quantity,
    current_price: price,
    market_value: marketValue,
    average_price: number([
      position["cost_basis"],
      position["average_purchase_price"],
      position["average_price"],
    ]),
    asset_type: text([instrument["kind"], position["type"]], "equity"),
    account_id: text([account["id"]]),
    account_name: text(
      [account["name"], account["institution_name"]],
      "Investment Account",
    ),
  };
}

function normalizeAccount(
  accountValue: unknown,
  balanceValue: unknown,
  positions: RecordValue[],
): RecordValue {
  const account = record(accountValue);
  const balances = array(balanceValue).map(record);
  const usd = balances.filter((balance) => {
    const code = text([
      pathValue(balance, ["currency", "code"]),
      balance["currency"],
    ]).toUpperCase();
    return !code || code === "USD";
  });
  const usableBalances = usd.length ? usd : balances;
  const cash = usableBalances.reduce(
    (sum, balance) => sum + number([balance["cash"], balance["amount"]]),
    0,
  );
  const buyingPower = usableBalances.reduce(
    (sum, balance) =>
      sum + number([balance["buying_power"], balance["buyingPower"]]),
    0,
  );
  const investedValue = positions.reduce(
    (sum, position) => sum + number([position["market_value"]]),
    0,
  );
  const reportedTotal = number([
    pathValue(account, ["balance", "total", "amount"]),
    account["total_value"],
  ]);

  return {
    id: text([account["id"]]),
    name: text(
      [account["name"], account["institution_name"]],
      "Investment Account",
    ),
    account_number: text([account["number"], account["account_number"]]),
    status: text([account["status"]], "connected"),
    cash,
    buying_power: buyingPower,
    invested_value: investedValue,
    total_value: reportedTotal || cash + investedValue,
  };
}

router.use(requireAuth, requireOwner);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/snaptrade/config-check", (_req, res) => {
  res.json({
    success: true,
    configured: configured(),
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
    const data = await requestSnapTrade<RecordValue>("/snapTrade/login", {
      method: "POST",
      body: {
        connectionType: "read",
        customRedirect:
          process.env["DASHBOARD_PUBLIC_URL"]?.trim() || DASHBOARD_URL,
        immediateRedirect: true,
        showCloseButton: true,
        darkMode: true,
        connectionPortalVersion: "v4",
      },
    });
    const redirectUri = text([data["redirectURI"], data["redirect_uri"]]);
    if (!redirectUri) throw new Error("Missing SnapTrade redirect URI");
    res.json({ success: true, redirect_uri: redirectUri });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "[snaptrade] connection portal failed",
    );
    res.status(502).json({
      success: false,
      error: "Failed to open the SnapTrade connection portal",
    });
  }
});

router.get("/snaptrade/connections", async (_req, res) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: "SnapTrade is not configured" });
    return;
  }
  try {
    const data = await requestSnapTrade<unknown[]>("/authorizations");
    res.json({ success: true, source: "snaptrade", data: array(data) });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "[snaptrade] connections failed",
    );
    res.status(502).json({
      success: false,
      error: "Failed to load SnapTrade connections",
    });
  }
});

router.get("/snaptrade/portfolio", async (_req, res) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: "SnapTrade is not configured" });
    return;
  }
  try {
    const rawAccounts = array(await requestSnapTrade<unknown[]>("/accounts"));
    const snapshots = await Promise.all(
      rawAccounts.map(async (accountValue) => {
        const accountId = text([record(accountValue)["id"]]);
        if (!accountId) return { accountValue, balances: [], positions: [] };
        const [balanceResult, positionResult] = await Promise.allSettled([
          requestSnapTrade<unknown[]>(
            `/accounts/${encodeURIComponent(accountId)}/balances`,
          ),
          requestSnapTrade<unknown>(
            `/accounts/${encodeURIComponent(accountId)}/positions/all`,
          ),
        ]);
        const balances =
          balanceResult.status === "fulfilled" ? array(balanceResult.value) : [];
        const positionPayload =
          positionResult.status === "fulfilled" ? positionResult.value : [];
        const rawPositions = Array.isArray(positionPayload)
          ? positionPayload
          : array(record(positionPayload)["results"]);
        const positions = rawPositions
          .map((position) => normalizePosition(position, accountValue))
          .filter((position): position is RecordValue => Boolean(position));
        return { accountValue, balances, positions };
      }),
    );
    const holdings = snapshots.flatMap((snapshot) => snapshot.positions);
    const accounts = snapshots.map((snapshot) =>
      normalizeAccount(
        snapshot.accountValue,
        snapshot.balances,
        snapshot.positions,
      ),
    );
    const cash = accounts.reduce(
      (sum, account) => sum + number([account["cash"]]),
      0,
    );
    const buyingPower = accounts.reduce(
      (sum, account) => sum + number([account["buying_power"]]),
      0,
    );
    const investedValue = holdings.reduce(
      (sum, holding) => sum + number([holding["market_value"]]),
      0,
    );
    const totalValue = accounts.reduce(
      (sum, account) => sum + number([account["total_value"]]),
      0,
    );

    res.json({
      success: true,
      source: "snaptrade",
      data: {
        source: "snaptrade",
        account_name: "SnapTrade",
        total_value: totalValue || cash + investedValue,
        cash,
        buying_power: buyingPower,
        invested_value: investedValue,
        day_change: 0,
        day_change_percent: 0,
        accounts,
        holdings,
        open_positions: holdings.length,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "[snaptrade] portfolio failed",
    );
    res.status(502).json({
      success: false,
      error: "Failed to load SnapTrade portfolio",
    });
  }
});

export default router;
