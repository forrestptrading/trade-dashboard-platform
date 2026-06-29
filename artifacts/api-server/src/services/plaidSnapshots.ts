import { and, eq, isNotNull } from "drizzle-orm";
import { db, brokerConnectionsTable, type BrokerConnection } from "@workspace/db";
import type {
  BrokerAccountSummary,
  BrokerHoldingPosition,
  BrokerMoney,
  BrokerProviderId,
  BrokerSyncStatus,
  NormalizedBrokerSnapshot,
} from "../broker/index.js";
import { decryptCredentialPayload } from "../lib/brokerCredentials.js";
import { logger } from "../lib/logger.js";
import type { PlaidCredentialRecord } from "./persistedBrokerConnections.js";

interface PlaidAccount {
  account_id: string;
  mask?: string | null;
  name?: string | null;
  official_name?: string | null;
  type?: string | null;
  subtype?: string | null;
  balances?: {
    available?: number | null;
    current?: number | null;
    iso_currency_code?: string | null;
  };
}

interface PlaidSecurity {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
}

interface PlaidHolding {
  account_id: string;
  security_id: string;
  quantity?: number | null;
  institution_price?: number | null;
  institution_value?: number | null;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
}

interface PlaidAccountsResponse {
  accounts?: PlaidAccount[];
  item?: { item_id?: string; institution_id?: string | null };
  request_id?: string;
}

interface PlaidHoldingsResponse extends PlaidAccountsResponse {
  holdings?: PlaidHolding[];
  securities?: PlaidSecurity[];
}

function plaidBaseUrl(): string {
  switch (process.env["PLAID_ENV"]) {
    case "production":
      return "https://production.plaid.com";
    case "development":
      return "https://development.plaid.com";
    default:
      return "https://sandbox.plaid.com";
  }
}

function money(amount = 0): BrokerMoney {
  const parsed = Number(amount);
  return { amount: Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0, currency: "USD" };
}

function asBrokerProviderId(value: string): BrokerProviderId {
  const allowed: BrokerProviderId[] = [
    "robinhood",
    "fidelity",
    "vanguard",
    "sofi",
    "webull",
    "schwab",
    "interactive-brokers",
    "etrade",
  ];

  return allowed.includes(value as BrokerProviderId) ? (value as BrokerProviderId) : "sofi";
}

function accountType(account?: PlaidAccount): BrokerAccountSummary["accountType"] {
  const subtype = account?.subtype?.toLowerCase() || "";

  if (subtype.includes("ira")) return "ira";
  if (subtype.includes("cash")) return "cash";
  if (subtype.includes("margin")) return "margin";
  if (account?.type === "investment") return "unknown";

  return "unknown";
}

function assetType(security?: PlaidSecurity): BrokerHoldingPosition["assetType"] {
  const type = security?.type?.toLowerCase() || "";

  if (type.includes("etf")) return "etf";
  if (type.includes("equity") || type.includes("stock")) return "equity";
  if (type.includes("cash")) return "cash";
  if (type.includes("option")) return "option";

  return "unknown";
}

async function postPlaid<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${plaidBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["PLAID_CLIENT_ID"],
      secret: process.env["PLAID_SECRET"],
      access_token: accessToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Plaid ${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

export async function listPersistedPlaidConnections(userId: string): Promise<BrokerConnection[]> {
  return db
    .select()
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.userId, userId),
        eq(brokerConnectionsTable.status, "connected"),
        isNotNull(brokerConnectionsTable.encryptedCredentials),
      ),
    );
}

function errorSnapshot(connection: BrokerConnection, message: string): NormalizedBrokerSnapshot {
  const brokerId = asBrokerProviderId(connection.brokerId);
  const now = new Date().toISOString();
  const syncStatus: BrokerSyncStatus = {
    brokerId,
    state: "error",
    lastSyncAt: now,
    message,
  };

  return {
    brokerId,
    source: brokerId,
    accountSummary: {
      brokerId,
      accountId: connection.id,
      accountName: connection.label || connection.brokerId,
      institutionName: connection.label || connection.brokerId,
      accountType: "unknown",
      totalValue: money(),
      cash: money(),
      buyingPower: money(),
      investedValue: money(),
      dayChange: money(),
      dayChangePercent: 0,
      totalReturn: money(),
      totalReturnPercent: 0,
      updatedAt: now,
    },
    cash: money(),
    buyingPower: money(),
    holdings: [],
    options: [],
    transactions: [],
    dividends: [],
    orders: [],
    syncStatus,
  };
}

export function normalizePlaidSnapshot(input: {
  connection: BrokerConnection;
  accountsResponse: PlaidAccountsResponse;
  holdingsResponse: PlaidHoldingsResponse;
}): NormalizedBrokerSnapshot {
  const brokerId = asBrokerProviderId(input.connection.brokerId);
  const accounts = input.holdingsResponse.accounts ?? input.accountsResponse.accounts ?? [];
  const holdings = input.holdingsResponse.holdings ?? [];
  const securities = new Map((input.holdingsResponse.securities ?? []).map((security) => [security.security_id, security]));
  const accountById = new Map(accounts.map((account) => [account.account_id, account]));
  const now = new Date().toISOString();
  const totalValue = accounts.reduce((sum, account) => sum + Number(account.balances?.current ?? 0), 0);
  const cash = accounts.reduce((sum, account) => sum + Number(account.balances?.available ?? 0), 0);
  const normalizedHoldings = holdings
    .map((holding): BrokerHoldingPosition | null => {
      const security = securities.get(holding.security_id);
      const account = accountById.get(holding.account_id);
      const symbol = security?.ticker_symbol || security?.name || holding.security_id;
      const quantity = Number(holding.quantity ?? 0);
      const marketValue = Number(holding.institution_value ?? 0);
      const price = Number(holding.institution_price ?? 0);
      const costBasis = Number(holding.cost_basis ?? 0);

      if (!symbol || !Number.isFinite(quantity) || !Number.isFinite(marketValue)) return null;

      return {
        brokerId,
        accountId: holding.account_id,
        accountName: account?.name || input.connection.label || input.connection.brokerId,
        symbol,
        quantity,
        ...(Number.isFinite(price) ? { currentPrice: money(price) } : {}),
        ...(Number.isFinite(costBasis) ? { averageCost: money(quantity > 0 ? costBasis / quantity : 0) } : {}),
        marketValue: money(marketValue),
        ...(Number.isFinite(costBasis) ? { totalGainLoss: money(marketValue - costBasis) } : {}),
        assetType: assetType(security),
      };
    })
    .filter((holding): holding is BrokerHoldingPosition => Boolean(holding));
  const investedValue = normalizedHoldings.reduce((sum, holding) => sum + holding.marketValue.amount, 0);
  const primaryAccount = accounts[0];
  const accountName = primaryAccount?.official_name || primaryAccount?.name || input.connection.label || input.connection.brokerId;
  const syncStatus: BrokerSyncStatus = {
    brokerId,
    state: "connected",
    lastSyncAt: now,
    message: "Plaid accounts and holdings synced successfully.",
  };

  return {
    brokerId,
    source: brokerId,
    accountSummary: {
      brokerId,
      accountId: primaryAccount?.account_id || input.connection.id,
      accountNumber: primaryAccount?.mask || undefined,
      accountName,
      institutionName: input.connection.label || accountName,
      accountType: accountType(primaryAccount),
      totalValue: money(totalValue || investedValue + cash),
      cash: money(cash),
      buyingPower: money(cash),
      investedValue: money(investedValue),
      dayChange: money(),
      dayChangePercent: 0,
      totalReturn: money(),
      totalReturnPercent: 0,
      updatedAt: now,
    },
    cash: money(cash),
    buyingPower: money(cash),
    holdings: normalizedHoldings,
    options: [],
    transactions: [],
    dividends: [],
    orders: [],
    syncStatus,
  };
}

export async function getPlaidSnapshotsForUser(userId: string): Promise<NormalizedBrokerSnapshot[]> {
  const connections = await listPersistedPlaidConnections(userId);

  return Promise.all(
    connections.map(async (connection) => {
      try {
        if (!connection.encryptedCredentials) {
          return errorSnapshot(connection, "Plaid credentials are missing for this connection.");
        }

        const credentials = decryptCredentialPayload<PlaidCredentialRecord>(connection.encryptedCredentials);
        const [accountsResponse, holdingsResponse] = await Promise.all([
          postPlaid<PlaidAccountsResponse>("/accounts/get", credentials.accessToken),
          postPlaid<PlaidHoldingsResponse>("/investments/holdings/get", credentials.accessToken),
        ]);

        return normalizePlaidSnapshot({ connection, accountsResponse, holdingsResponse });
      } catch (error) {
        logger.warn(
          { connectionId: connection.id, brokerId: connection.brokerId, err: error instanceof Error ? error.message : String(error) },
          "[plaid] snapshot sync failed",
        );
        return errorSnapshot(connection, "Plaid snapshot sync failed. Reconnect or retry later.");
      }
    }),
  );
}
