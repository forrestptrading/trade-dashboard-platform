import { Router, type IRouter } from "express";
import {
  BROKER_CAPABILITY_MATRIX,
  aggregateBrokerSnapshots,
  brokerEngine,
  getBroker,
  listBrokers,
  useLiveData,
  type BrokerProviderId,
  type BrokerSyncState,
  type NormalizedBrokerSnapshot,
  type SkippedBrokerStatus,
} from "../broker/index.js";
import { logger } from "../lib/logger.js";
import { optionalAuth } from "../middlewares/auth.js";
import { getPlaidSnapshotsForUser } from "../services/plaidSnapshots.js";
import {
  connectedBrokerConnections,
  type BrokerConnectionRecord,
} from "../services/brokerConnectionsStore.js";

const router: IRouter = Router();

router.use(optionalAuth);

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

function mockRobinhoodSnapshot(): NormalizedBrokerSnapshot {
  const now = new Date().toISOString();
  const holdings = [
    {
      brokerId: "robinhood" as const,
      accountName: "Robinhood Mock",
      symbol: "AAPL",
      quantity: 10,
      marketValue: money(2978.9),
      assetType: "equity" as const,
    },
    {
      brokerId: "robinhood" as const,
      accountName: "Robinhood Mock",
      symbol: "NVDA",
      quantity: 15,
      marketValue: money(3153),
      assetType: "equity" as const,
    },
    {
      brokerId: "robinhood" as const,
      accountName: "Robinhood Mock",
      symbol: "TSLA",
      quantity: 8,
      marketValue: money(3204),
      assetType: "equity" as const,
    },
    {
      brokerId: "robinhood" as const,
      accountName: "Robinhood Mock",
      symbol: "SPY",
      quantity: 5,
      marketValue: money(3732.85),
      assetType: "equity" as const,
    },
  ];

  return {
    brokerId: "robinhood",
    source: "mock",
    accountSummary: {
      brokerId: "robinhood",
      accountId: "robinhood-mock",
      accountNumber: "MOCK-12345678",
      accountName: "Robinhood Mock",
      institutionName: "Robinhood",
      accountType: "unknown",
      totalValue: money(999999.99),
      cash: money(77777.77),
      buyingPower: money(88888.88),
      investedValue: money(49100.31),
      dayChange: money(6666.66),
      dayChangePercent: 12.34,
      totalReturn: money(7241.87),
      totalReturnPercent: 16.07,
      updatedAt: now,
    },
    cash: money(77777.77),
    buyingPower: money(88888.88),
    holdings,
    options: [],
    transactions: [],
    dividends: [],
    orders: [],
    syncStatus: {
      brokerId: "robinhood",
      state: "mock",
      lastSyncAt: now,
      message: "Live broker data is disabled; included mock Robinhood snapshot.",
    },
  };
}

function connectionSnapshot(connection: BrokerConnectionRecord): NormalizedBrokerSnapshot {
  const provider = connection.provider as BrokerProviderId;
  const now = connection.last_connected ?? new Date().toISOString();
  const investedValue = connection.holdings.reduce(
    (sum, holding) => sum + Number(holding.market_value || 0),
    0,
  );
  const holdings = connection.holdings.map((holding) => ({
    brokerId: provider,
    accountId: connection.id,
    accountName: connection.name,
    symbol: holding.symbol,
    quantity: Number(holding.quantity || 0),
    ...(holding.average_cost !== undefined ? { averageCost: money(holding.average_cost) } : {}),
    ...(holding.current_price !== undefined ? { currentPrice: money(holding.current_price) } : {}),
    marketValue: money(holding.market_value),
    assetType: "equity" as const,
  }));

  return {
    brokerId: provider,
    source: provider,
    accountSummary: {
      brokerId: provider,
      accountId: connection.id,
      accountName: connection.name,
      institutionName: connection.name,
      accountType: "unknown",
      totalValue: money(connection.balance),
      cash: money(connection.buying_power),
      buyingPower: money(connection.buying_power),
      investedValue: money(investedValue),
      dayChange: money(),
      dayChangePercent: 0,
      totalReturn: money(),
      totalReturnPercent: 0,
      updatedAt: now,
    },
    cash: money(connection.buying_power),
    buyingPower: money(connection.buying_power),
    holdings,
    options: [],
    transactions: [],
    dividends: [],
    orders: [],
    syncStatus: {
      brokerId: provider,
      state: "connected",
      lastSyncAt: connection.last_connected,
      message: "Included connected Plaid/demo broker connection.",
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

async function getAggregateSnapshot(
  brokerId: BrokerProviderId,
): Promise<{ snapshot?: NormalizedBrokerSnapshot; skipped?: SkippedBrokerStatus }> {
  if (!IMPLEMENTED_BROKERS.has(brokerId)) {
    return {
      skipped: {
        broker_id: brokerId,
        reason: `${BROKER_NAMES[brokerId]} adapter is registered but not implemented yet.`,
        status: "not_implemented",
      },
    };
  }

  const broker = getBroker(brokerId);

  if (!useLiveData()) {
    return {
      snapshot: brokerId === "robinhood"
        ? mockRobinhoodSnapshot()
        : unavailableSnapshot(
            brokerId,
            "mock",
            "Live broker data is disabled; included as an empty normalized mock snapshot.",
          ),
    };
  }

  if (!broker.isAuthenticated()) {
    return {
      skipped: {
        broker_id: brokerId,
        reason: `${BROKER_NAMES[brokerId]} credentials are not configured.`,
        status: "not_configured",
      },
    };
  }

  try {
    return { snapshot: await brokerEngine.getSnapshot(brokerId) };
  } catch (error) {
    logger.warn(
      { broker: brokerId, err: error instanceof Error ? error.message : String(error) },
      "[broker-engine] aggregate snapshot skipped",
    );

    return {
      skipped: {
        broker_id: brokerId,
        reason: "Broker snapshot failed. Check server logs for sanitized details.",
        status: "error",
      },
    };
  }
}

router.get("/broker-engine/aggregate", async (req, res) => {
  const results = await Promise.all(listBrokers().map((brokerId) => getAggregateSnapshot(brokerId)));
  const snapshots = results
    .map((result) => result.snapshot)
    .filter((snapshot): snapshot is NormalizedBrokerSnapshot => Boolean(snapshot));
  const skippedBrokers = results
    .map((result) => result.skipped)
    .filter((skipped): skipped is SkippedBrokerStatus => Boolean(skipped));
  const connectionSnapshots = connectedBrokerConnections().map(connectionSnapshot);
  let plaidSnapshots: NormalizedBrokerSnapshot[] = [];
  let skippedPlaidSnapshots: SkippedBrokerStatus[] = [];

  if (req.user) {
    try {
      const syncedPlaidSnapshots = await getPlaidSnapshotsForUser(req.user.id);
      plaidSnapshots = syncedPlaidSnapshots.filter((snapshot) => snapshot.syncStatus.state !== "error");
      skippedPlaidSnapshots = syncedPlaidSnapshots
        .filter((snapshot) => snapshot.syncStatus.state === "error")
        .map((snapshot) => ({
          broker_id: snapshot.brokerId,
          reason: snapshot.syncStatus.message || "Plaid snapshot sync failed.",
          status: "error" as const,
        }));
    } catch (error) {
      logger.warn(
        { userId: req.user.id, err: error instanceof Error ? error.message : String(error) },
        "[broker-engine] Plaid snapshots unavailable during aggregate",
      );
      skippedPlaidSnapshots = [
        {
          broker_id: "sofi",
          reason: "Plaid snapshots are unavailable. Check server logs for sanitized details.",
          status: "error",
        },
      ];
    }
  }

  const data = aggregateBrokerSnapshots(
    [...snapshots, ...connectionSnapshots, ...plaidSnapshots],
    [...skippedBrokers, ...skippedPlaidSnapshots],
  );

  res.json({
    success: true,
    source: "broker-engine",
    status: data.sync_status.state,
    data,
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
