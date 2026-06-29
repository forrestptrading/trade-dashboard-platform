import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  createBrokerConnection,
  isBrokerProvider,
  storePlaidAccessToken,
  type BrokerProvider,
} from "../services/brokerConnectionsStore.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth/password.js";
import { logger } from "../lib/logger.js";
import { optionalAuth } from "../middlewares/auth.js";
import {
  getLatestPlaidCredentialForUser,
  listSafePlaidConnectionsForUser,
  normalizePlaidSafeAccounts,
  persistPlaidBrokerConnection,
} from "../services/persistedBrokerConnections.js";
import { getPlaidSnapshotsForUser } from "../services/plaidSnapshots.js";

const router: IRouter = Router();

router.use(optionalAuth);

const PLAID_NOT_CONFIGURED_MESSAGE = "Plaid is not configured yet. Demo connection is available.";
const PLAID_AUTH_REQUIRED_MESSAGE = "Authentication is required to persist a Plaid connection.";
const PLAID_DEMO_USER_EMAIL = "forrest-main-user@plaid-demo.local";

let temporaryPlaidAccessToken: string | null = null;
let temporaryPlaidConnection: {
  item_id: string;
  institution_name: string | null;
  accounts: ReturnType<typeof normalizePlaidSafeAccounts>;
  created_at: string;
  updated_at: string;
} | null = null;

const createLinkTokenSchema = z.object({
  provider: z.string().refine(isBrokerProvider, {
    message: "Unsupported broker provider",
  }),
});

const exchangePublicTokenSchema = z.object({
  provider: z.string().refine(isBrokerProvider, {
    message: "Unsupported broker provider",
  }),
  public_token: z.string().min(1),
});

const directExchangePublicTokenSchema = z.object({
  public_token: z.string().min(1),
  metadata: z.unknown().optional(),
});

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

function plaidConfigured(): boolean {
  return Boolean(
    process.env["PLAID_CLIENT_ID"]?.trim() &&
      process.env["PLAID_SECRET"]?.trim() &&
      process.env["PLAID_ENV"]?.trim(),
  );
}

async function postPlaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${plaidBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["PLAID_CLIENT_ID"],
      secret: process.env["PLAID_SECRET"],
      ...body,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Plaid ${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

async function getOrCreateDemoPlaidUserId(): Promise<string> {
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, PLAID_DEMO_USER_EMAIL))
    .limit(1);

  if (existing[0]) {
    return existing[0].id;
  }

  const passwordHash = await hashPassword(`demo-plaid-${Date.now()}-${Math.random()}`);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: PLAID_DEMO_USER_EMAIL,
      passwordHash,
      lastLogin: new Date(),
    })
    .returning({ id: usersTable.id });

  if (!user) {
    throw new Error("Failed to create Plaid demo user.");
  }

  return user.id;
}

async function resolvePlaidStorageUserId(authenticatedUserId?: string): Promise<string> {
  return authenticatedUserId || getOrCreateDemoPlaidUserId();
}

function readInstitutionName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const metadata = payload as Record<string, unknown>;
  const institution = metadata["institution"];

  if (institution && typeof institution === "object") {
    const name = (institution as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim()) return name;
  }

  const institutionName = metadata["institution_name"];
  return typeof institutionName === "string" && institutionName.trim() ? institutionName : null;
}

function rememberTemporaryPlaidConnection(input: {
  itemId: string;
  institutionName?: string | null;
  accounts?: unknown;
}): void {
  const now = new Date().toISOString();
  temporaryPlaidConnection = {
    item_id: input.itemId,
    institution_name: input.institutionName ?? null,
    accounts: normalizePlaidSafeAccounts(input.accounts),
    created_at: temporaryPlaidConnection?.created_at ?? now,
    updated_at: now,
  };
}



router.get("/plaid/config-check", (_req, res) => {
  res.json({
    success: true,
    plaid: {
      client_id_present: Boolean(process.env["PLAID_CLIENT_ID"]?.trim()),
      secret_present: Boolean(process.env["PLAID_SECRET"]?.trim()),
      env_present: Boolean(process.env["PLAID_ENV"]?.trim()),
      env: process.env["PLAID_ENV"] || null,
    },
  });
});

router.post("/plaid/create_link_token", async (_req, res) => {
  if (!plaidConfigured()) {
    res.status(500).json({ success: false, error: "Plaid is not configured" });
    return;
  }

  try {
    logger.info("[plaid] creating production Link token");
    const data = await postPlaid<{ link_token: string }>("/link/token/create", {
      client_name: "Forrest Trading Dashboard",
      language: "en",
      country_codes: ["US"],
      products: ["investments"],
      user: {
        client_user_id: "forrest-main-user",
      },
    });

    res.json({ success: true, link_token: data.link_token });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ err: msg }, "[plaid] direct create_link_token failed");
    res.status(502).json({ success: false, error: "Failed to create Plaid link token" });
  }
});

router.post("/plaid/exchange_public_token", async (req, res) => {
  const parsed = directExchangePublicTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid Plaid public token exchange" });
    return;
  }

  if (!plaidConfigured()) {
    res.status(500).json({ success: false, error: "Plaid is not configured" });
    return;
  }

  try {
    logger.info("[plaid] exchanging public token with direct REST endpoint");
    const data = await postPlaid<{ access_token: string; item_id: string; request_id?: string }>(
      "/item/public_token/exchange",
      { public_token: parsed.data.public_token },
    );

    temporaryPlaidAccessToken = data.access_token;
    rememberTemporaryPlaidConnection({
      itemId: data.item_id,
      institutionName: readInstitutionName(parsed.data.metadata),
    });

    let accounts: unknown[] = [];
    try {
      const holdingsData = await postPlaid<{ accounts?: unknown[] }>("/investments/holdings/get", {
        access_token: data.access_token,
      });
      accounts = holdingsData.accounts ?? [];
      rememberTemporaryPlaidConnection({
        itemId: data.item_id,
        institutionName: readInstitutionName(parsed.data.metadata),
        accounts,
      });
    } catch (accountErr) {
      logger.warn(
        { itemId: data.item_id, err: accountErr instanceof Error ? accountErr.message : String(accountErr) },
        "[plaid] exchanged public token but account metadata fetch failed",
      );
    }

    try {
      const userId = await resolvePlaidStorageUserId(req.user?.id);
      const persistedConnection = await persistPlaidBrokerConnection({
        userId,
        provider: "robinhood",
        label: `plaid:${data.item_id}`,
        accessToken: data.access_token,
        itemId: data.item_id,
        requestId: data.request_id,
        institutionName: readInstitutionName(parsed.data.metadata),
        accounts: normalizePlaidSafeAccounts(accounts),
      });

      logger.info(
        { connectionId: persistedConnection.id, itemId: data.item_id, authenticated: Boolean(req.user) },
        "[plaid] exchanged public token and persisted encrypted Plaid credentials",
      );
      res.json({ success: true, item_id: data.item_id, source: "database" });
      return;
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      logger.warn({ itemId: data.item_id, err: msg }, "[plaid] persistent Plaid storage failed; using memory fallback");
      res.json({
        success: true,
        item_id: data.item_id,
        source: "memory",
        warning: "Plaid connected for this server session, but persistent storage is unavailable.",
      });
      return;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ err: msg }, "[plaid] direct exchange_public_token failed");
    res.status(502).json({ success: false, error: "Failed to exchange Plaid public token" });
  }
});

router.get("/plaid/investments", async (req, res) => {
  if (!plaidConfigured()) {
    res.status(500).json({ success: false, error: "Plaid is not configured" });
    return;
  }

  let accessToken = temporaryPlaidAccessToken;
  let source: "database" | "memory" = "memory";

  try {
    const userId = await resolvePlaidStorageUserId(req.user?.id);
    const persisted = await getLatestPlaidCredentialForUser(userId);

    if (persisted) {
      accessToken = persisted.credentials.accessToken;
      source = "database";
    }
  } catch (storageErr) {
    logger.warn(
      { err: storageErr instanceof Error ? storageErr.message : String(storageErr) },
      "[plaid] persistent Plaid credential lookup failed; falling back to memory",
    );
  }

  if (!accessToken) {
    res.status(400).json({ success: false, error: "No Plaid access token is stored. Connect Plaid first." });
    return;
  }

  try {
    logger.info({ source }, "[plaid] fetching investment holdings");
    const data = await postPlaid<{ accounts?: unknown[]; holdings?: unknown[]; securities?: unknown[] }>(
      "/investments/holdings/get",
      { access_token: accessToken },
    );

    res.json({
      success: true,
      source,
      accounts: data.accounts ?? [],
      holdings: data.holdings ?? [],
      securities: data.securities ?? [],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ err: msg }, "[plaid] direct investments fetch failed");
    res.status(502).json({ success: false, error: "Failed to fetch Plaid investments" });
  }
});

router.get("/plaid/connections", async (req, res) => {
  try {
    const userId = await resolvePlaidStorageUserId(req.user?.id);
    const connections = await listSafePlaidConnectionsForUser(userId);

    res.json({
      success: true,
      source: "database",
      count: connections.length,
      data: connections,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ err: msg }, "[plaid] safe Plaid connection list failed; falling back to memory metadata");

    const memoryConnections = temporaryPlaidConnection ? [temporaryPlaidConnection] : [];
    res.json({
      success: true,
      source: "memory",
      count: memoryConnections.length,
      data: memoryConnections,
      warning: "Persistent Plaid connection storage is unavailable.",
    });
  }
});

router.get("/plaid/snapshots", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  try {
    const snapshots = await getPlaidSnapshotsForUser(req.user.id);
    res.json({ success: true, source: "plaid", count: snapshots.length, data: snapshots });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ err: msg }, "[plaid] snapshot list failed");
    res.status(500).json({ success: false, error: "Failed to load Plaid snapshots" });
  }
});

router.post("/plaid/create-link-token", async (req, res) => {
  const parsed = createLinkTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid Plaid link token request", details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!plaidConfigured()) {
    logger.info("[plaid] create link token requested but Plaid is not configured");
    res.json({ success: true, configured: false, link_token: null, message: PLAID_NOT_CONFIGURED_MESSAGE });
    return;
  }

  try {
    const provider = parsed.data.provider as BrokerProvider;
    const data = await postPlaid<{ link_token: string; expiration: string; request_id: string }>("/link/token/create", {
      client_name: "Trade Dashboard Platform",
      language: "en",
      country_codes: ["US"],
      products: ["investments"],
      user: {
        client_user_id: `trade-dashboard-${provider}`,
      },
    });

    res.json({
      success: true,
      configured: true,
      link_token: data.link_token,
      expiration: data.expiration,
      request_id: data.request_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[plaid] create link token failed");
    res.status(502).json({ success: false, error: "Failed to create Plaid link token" });
  }
});

router.post("/plaid/exchange-public-token", async (req, res) => {
  const parsed = exchangePublicTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid Plaid public token exchange", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const provider = parsed.data.provider as BrokerProvider;

  if (!plaidConfigured()) {
    const connection = createBrokerConnection({ provider });
    logger.info({ provider }, "[plaid] public token exchange requested without Plaid config; created demo connection");
    res.json({ success: true, configured: false, source: "memory", message: PLAID_NOT_CONFIGURED_MESSAGE, data: connection });
    return;
  }

  if (!req.user) {
    logger.warn({ provider }, "[plaid] authenticated user required before exchanging public token");
    res.status(401).json({ success: false, error: PLAID_AUTH_REQUIRED_MESSAGE });
    return;
  }

  try {
    const data = await postPlaid<{ access_token: string; item_id: string; request_id: string }>(
      "/item/public_token/exchange",
      { public_token: parsed.data.public_token },
    );

    try {
      const persistedConnection = await persistPlaidBrokerConnection({
        userId: req.user.id,
        provider,
        label: provider,
        accessToken: data.access_token,
        itemId: data.item_id,
        requestId: data.request_id,
      });

      logger.info({ provider, connectionId: persistedConnection.id, itemId: data.item_id }, "[plaid] exchanged public token and persisted encrypted broker credentials");
      res.json({
        success: true,
        configured: true,
        source: "database",
        request_id: data.request_id,
        data: {
          id: persistedConnection.id,
          name: persistedConnection.label || provider,
          provider,
          status: persistedConnection.status,
          account_type: "brokerage",
          last_connected: persistedConnection.updatedAt,
        },
      });
      return;
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      logger.warn({ provider, err: msg }, "[plaid] encrypted credential persistence failed");

      if (process.env["NODE_ENV"] === "production") {
        res.status(500).json({ success: false, error: "Failed to persist Plaid credentials securely" });
        return;
      }

      const connection = createBrokerConnection({ provider });
      storePlaidAccessToken(connection.id, {
        accessToken: data.access_token,
        itemId: data.item_id,
        provider,
      });

      logger.warn({ provider, connectionId: connection.id }, "[plaid] using non-production memory fallback for Plaid credentials");
      res.json({
        success: true,
        configured: true,
        source: "memory",
        persistence: "memory_fallback",
        warning: "Plaid credentials are stored in memory for this non-production run only.",
        request_id: data.request_id,
        data: connection,
      });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[plaid] public token exchange failed");
    res.status(502).json({ success: false, error: "Failed to exchange Plaid public token" });
  }
});

export default router;
