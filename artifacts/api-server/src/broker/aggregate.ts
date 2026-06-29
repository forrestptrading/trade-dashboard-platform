import type {
  BrokerDividend,
  BrokerHoldingPosition,
  BrokerMoney,
  BrokerOptionPosition,
  BrokerProviderId,
  BrokerSyncState,
  BrokerTransaction,
  NormalizedBrokerSnapshot,
} from "./model.js";

export interface SkippedBrokerStatus {
  broker_id: BrokerProviderId;
  reason: string;
  status: "skipped" | "error" | "not_implemented" | "not_configured";
}

export interface BrokerBreakdownItem {
  broker_id: BrokerProviderId;
  source: NormalizedBrokerSnapshot["source"];
  account_name: string;
  total_value: number;
  cash: number;
  buying_power: number;
  invested_value: number;
  holdings_count: number;
  options_count: number;
  sync_status: NormalizedBrokerSnapshot["syncStatus"];
}

export interface UnifiedPortfolioSyncStatus {
  state: BrokerSyncState | "partial";
  last_sync_at: string | null;
  included_brokers: BrokerProviderId[];
  skipped_brokers: SkippedBrokerStatus[];
}

export interface UnifiedPortfolio {
  total_value: number;
  cash: number;
  buying_power: number;
  invested_value: number;
  holdings: BrokerHoldingPosition[];
  options: BrokerOptionPosition[];
  dividends: BrokerDividend[];
  transactions: BrokerTransaction[];
  broker_breakdown: BrokerBreakdownItem[];
  sync_status: UnifiedPortfolioSyncStatus;
}

function amount(value?: BrokerMoney): number {
  const parsed = Number(value?.amount);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function latestSyncDate(snapshots: NormalizedBrokerSnapshot[]): string | null {
  const timestamps = snapshots
    .map((snapshot) => snapshot.syncStatus.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (!timestamps.length) return null;

  return new Date(Math.max(...timestamps)).toISOString();
}

function aggregateSyncState(
  snapshots: NormalizedBrokerSnapshot[],
  skippedBrokers: SkippedBrokerStatus[],
): UnifiedPortfolioSyncStatus["state"] {
  if (!snapshots.length) return skippedBrokers.length ? "error" : "offline";
  if (skippedBrokers.length) return "partial";
  if (snapshots.some((snapshot) => snapshot.syncStatus.state === "connected")) return "connected";
  if (snapshots.some((snapshot) => snapshot.syncStatus.state === "mock")) return "mock";
  return snapshots[0]?.syncStatus.state ?? "offline";
}

export function aggregateBrokerSnapshots(
  snapshots: NormalizedBrokerSnapshot[],
  skippedBrokers: SkippedBrokerStatus[] = [],
): UnifiedPortfolio {
  const holdings = snapshots.flatMap((snapshot) => snapshot.holdings);
  const options = snapshots.flatMap((snapshot) => snapshot.options);
  const dividends = snapshots.flatMap((snapshot) => snapshot.dividends);
  const transactions = snapshots.flatMap((snapshot) => snapshot.transactions);

  const brokerBreakdown = snapshots.map((snapshot) => ({
    broker_id: snapshot.brokerId,
    source: snapshot.source,
    account_name: snapshot.accountSummary.accountName,
    total_value: round(amount(snapshot.accountSummary.totalValue)),
    cash: round(amount(snapshot.cash)),
    buying_power: round(amount(snapshot.buyingPower)),
    invested_value: round(amount(snapshot.accountSummary.investedValue)),
    holdings_count: snapshot.holdings.length,
    options_count: snapshot.options.length,
    sync_status: snapshot.syncStatus,
  }));

  return {
    total_value: round(
      snapshots.reduce((sum, snapshot) => sum + amount(snapshot.accountSummary.totalValue), 0),
    ),
    cash: round(snapshots.reduce((sum, snapshot) => sum + amount(snapshot.cash), 0)),
    buying_power: round(
      snapshots.reduce((sum, snapshot) => sum + amount(snapshot.buyingPower), 0),
    ),
    invested_value: round(
      snapshots.reduce((sum, snapshot) => sum + amount(snapshot.accountSummary.investedValue), 0),
    ),
    holdings,
    options,
    dividends,
    transactions,
    broker_breakdown: brokerBreakdown,
    sync_status: {
      state: aggregateSyncState(snapshots, skippedBrokers),
      last_sync_at: latestSyncDate(snapshots),
      included_brokers: snapshots.map((snapshot) => snapshot.brokerId),
      skipped_brokers: skippedBrokers,
    },
  };
}
