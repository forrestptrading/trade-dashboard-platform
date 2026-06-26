/**
 * Portfolio Analytics Service.
 *
 * Pure computation over a normalized PortfolioSnapshot. No I/O here — the route
 * layer obtains the snapshot (live or mock) and passes it in.
 */
import type { Holding, PortfolioSnapshot } from "./portfolioData.js";

export interface AllocationSlice {
  key: string;
  value: number;
  percent: number;
}

export interface PositionHighlight {
  symbol: string;
  broker: string;
  sector: string;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
}

export interface PortfolioAnalytics {
  totalValue: number;
  investedValue: number;
  cash: number;
  cashPercentage: number;
  investedPercentage: number;
  dailyPL: { value: number; percent: number };
  totalPL: { value: number; percent: number };
  allocationByAsset: AllocationSlice[];
  allocationBySector: AllocationSlice[];
  allocationByBroker: AllocationSlice[];
  largestPosition: PositionHighlight | null;
  largestGain: PositionHighlight | null;
  largestLoss: PositionHighlight | null;
  diversificationScore: number;
  positionCount: number;
}

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function highlight(h: Holding): PositionHighlight {
  return {
    symbol: h.symbol,
    broker: h.broker,
    sector: h.sector,
    marketValue: h.marketValue,
    unrealizedPL: h.unrealizedPL,
    unrealizedPLPercent: h.unrealizedPLPercent,
  };
}

function groupBy(
  holdings: Holding[],
  total: number,
  pick: (h: Holding) => string,
): AllocationSlice[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    totals.set(pick(h), (totals.get(pick(h)) ?? 0) + h.marketValue);
  }
  return [...totals.entries()]
    .map(([key, value]) => ({
      key,
      value: round(value),
      percent: round(total > 0 ? (value / total) * 100 : 0),
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Diversification score (0–100). Combines how evenly capital is spread across
 * individual positions (60%) and across sectors (40%) using a normalized
 * Herfindahl-Hirschman concentration index. Higher = more diversified.
 */
function diversificationScore(holdings: Holding[]): number {
  const invested = holdings.reduce((s, h) => s + h.marketValue, 0);
  if (invested <= 0 || holdings.length === 0) return 0;

  const assetHHI = holdings.reduce((s, h) => {
    const w = h.marketValue / invested;
    return s + w * w;
  }, 0);

  const sectorTotals = new Map<string, number>();
  for (const h of holdings) {
    sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + h.marketValue);
  }
  const sectorHHI = [...sectorTotals.values()].reduce((s, v) => {
    const w = v / invested;
    return s + w * w;
  }, 0);

  const assetDiv = 1 - assetHHI;
  const sectorDiv = 1 - sectorHHI;
  const score = (0.6 * assetDiv + 0.4 * sectorDiv) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computePortfolioAnalytics(
  snapshot: PortfolioSnapshot,
): PortfolioAnalytics {
  const { holdings, totalValue, investedValue, cash } = snapshot;

  let largestPosition: Holding | null = null;
  let largestGain: Holding | null = null;
  let largestLoss: Holding | null = null;
  for (const h of holdings) {
    if (!largestPosition || h.marketValue > largestPosition.marketValue) {
      largestPosition = h;
    }
    if (!largestGain || h.unrealizedPL > largestGain.unrealizedPL) {
      largestGain = h;
    }
    if (!largestLoss || h.unrealizedPL < largestLoss.unrealizedPL) {
      largestLoss = h;
    }
  }

  return {
    totalValue: snapshot.totalValue,
    investedValue: snapshot.investedValue,
    cash: snapshot.cash,
    cashPercentage: round(totalValue > 0 ? (cash / totalValue) * 100 : 0),
    investedPercentage: round(
      totalValue > 0 ? (investedValue / totalValue) * 100 : 0,
    ),
    dailyPL: { value: snapshot.dayChange, percent: snapshot.dayChangePercent },
    totalPL: { value: snapshot.totalPL, percent: snapshot.totalPLPercent },
    allocationByAsset: groupBy(holdings, totalValue, (h) => h.symbol),
    allocationBySector: groupBy(holdings, totalValue, (h) => h.sector),
    allocationByBroker: groupBy(holdings, totalValue, (h) => h.broker),
    largestPosition: largestPosition ? highlight(largestPosition) : null,
    largestGain: largestGain ? highlight(largestGain) : null,
    largestLoss: largestLoss ? highlight(largestLoss) : null,
    diversificationScore: diversificationScore(holdings),
    positionCount: holdings.length,
  };
}
