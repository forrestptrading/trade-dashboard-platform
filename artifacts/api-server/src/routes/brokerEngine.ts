import { Router, type IRouter } from "express";
import {
  BROKER_CAPABILITY_MATRIX,
  brokerEngine,
  getBroker,
  listBrokers,
  useLiveData,
  type BrokerProviderId,
  type BrokerSyncState,
  type NormalizedBrokerSnapshot,
} from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const BROKER_NAMES: Record<BrokerProviderId, string> = {
  robinhood: "Robinhood",
  fidelity: "Fidelity",
  vanguard: "Vanguard",
  sofi: "SoFi Invest",
  webull: "Webull",
  schwab: "Charles Schwab",
  "interactive-brokers": "Interactive Brokers",
  etrade: "E*TRADE",
};

const IMPLEMENTED_BROKERS = new Set<BrokerProviderId>(["robinhood"]);

function isBrokerProviderId(value: string): value is BrokerProviderId {
  return Object.hasOwn(BROKER_CAPABILITY_MATRIX, value);
}

function adapterSummary(id: BrokerProviderId) {
  const broker = getBroker(id);
  const implemented = IMPLEMENTED_BROKERS.has(id);

  return {
    id,
    name: BROKER_NAMES[id],
    implemented,
    stubbed: !implemented,
    authenticated: implemented ? broker.isAuthenticated() : false,
    capabilities: BROKER_CAPABILITY_MATRIX[id],
  };
}

function money(amount = 0) {
  return { amount, currency: "USD" as const };
}

function unavailableSnapshot(
  brokerId: BrokerProviderId,
  state: BrokerSyncState,
  message: string,
): NormalizedBrokerSnapshot {
  const now = new Date().toISOString();
  const name = BROKER_NAMES[brokerId];

  return {
    brokerId,
    source: "mock",
    accountSummary: {
      brokerId,
      accountId: `${brokerId}-unavailable`,
      accountName: name,
      institutionName: name,
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
    syncStatus: {
      brokerId,
      state,
      lastSyncAt: null,
      message,
    },
  };
}

router.get("/broker-engine/capabilities", (_req, res) => {
  res.json({
    success: true,
    data: BROKER_CAPABILITY_MATRIX,
  });
});

router.get("/broker-engine/adapters", (_req, res) => {
  res.json({
    success: true,
    data: listBrokers().map(adapterSummary),
  });
});

router.get("/broker-engine/:broker/snapshot", async (req, res) => {
  const brokerId = req.params["broker"]?.toLowerCase().trim() ?? "";

  if (!isBrokerProviderId(brokerId)) {
    res.status(404).json({
      success: false,
      error: {
        code: "BROKER_NOT_FOUND",
        message: "Broker adapter is not registered.",
      },
    });
    return;
  }

  if (!IMPLEMENTED_BROKERS.has(brokerId)) {
    res.status(501).json({
      success: false,
      broker: brokerId,
      error: {
        code: "BROKER_NOT_IMPLEMENTED",
        message: `${BROKER_NAMES[brokerId]} adapter is registered but not implemented yet.`,
      },
    });
    return;
  }

  const broker = getBroker(brokerId);

  if (!useLiveData()) {
    res.json({
      success: true,
      broker: brokerId,
      source: "mock",
      data: unavailableSnapshot(
        brokerId,
        "mock",
        "Live broker data is disabled; returning an empty normalized mock snapshot.",
      ),
    });
    return;
  }

  if (!broker.isAuthenticated()) {
    res.status(503).json({
      success: false,
      broker: brokerId,
      error: {
        code: "BROKER_NOT_CONFIGURED",
        message: `${BROKER_NAMES[brokerId]} live data is enabled but credentials are not configured.`,
      },
      data: unavailableSnapshot(
        brokerId,
        "not_configured",
        "Broker credentials are not configured on the server.",
      ),
    });
    return;
  }

  try {
    const snapshot = await brokerEngine.getSnapshot(brokerId);

    res.json({
      success: true,
      broker: brokerId,
      source: snapshot.source,
      data: snapshot,
    });
  } catch (error) {
    logger.warn(
      { broker: brokerId, err: error instanceof Error ? error.message : String(error) },
      "[broker-engine] snapshot failed",
    );

    res.status(502).json({
      success: false,
      broker: brokerId,
      error: {
        code: "BROKER_SNAPSHOT_FAILED",
        message: "Broker snapshot failed. No secrets were exposed.",
      },
      data: unavailableSnapshot(
        brokerId,
        "error",
        "Broker snapshot failed; check server logs for sanitized details.",
      ),
    });
  }
});

export default router;
