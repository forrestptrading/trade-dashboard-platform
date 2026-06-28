import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  createBrokerConnection,
  isBrokerProvider,
  storePlaidAccessToken,
  type BrokerProvider,
} from "../services/brokerConnectionsStore.js";
import { logger } from "../lib/logger.js";
import { optionalAuth } from "../middlewares/auth.js";
import { persistPlaidBrokerConnection } from "../services/persistedBrokerConnections.js";

const router: IRouter = Router();

router.use(optionalAuth);

const PLAID_NOT_CONFIGURED_MESSAGE = "Plaid is not configured yet. Demo connection is available.";
const PLAID_AUTH_REQUIRED_MESSAGE = "Authentication is required to persist a Plaid connection.";

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
