/**
 * Risk Engine.
 *
 * Pure computation over a normalized PortfolioSnapshot. Estimated beta and max
 * drawdown are placeholders (clearly flagged) until full price history is wired
 * through the broker abstraction.
 */
import type { PortfolioSnapshot } from "./portfolioData.js";

export interface RiskReport {
  positionConcentration: number; // % held in the top 3 positions
  largestPositionPercent: number; // % of portfolio in the single largest position
  sectorConcentration: number; // % of portfolio in the most-weighted sector
  cashExposure: number; // cash as % of portfolio
  estimatedBeta: number; // placeholder, market-weighted
  estimatedBetaIsPlaceholder: boolean;
  maxDrawdown: number; // placeholder, percent (negative)
  maxDrawdownIsPlaceholder: boolean;
  overallRiskScore: number; // 0–100, higher = riskier
  riskLevel: "low" | "moderate" | "high";
}

const BETA_MAP: Record<string, number> = {
  AAPL: 1.25,
  MSFT: 0.95,
  NVDA: 1.7,
  GOOGL: 1.05,
  META: 1.2,
  TSLA: 1.9,
  AMZN: 1.3,
  JPM: 1.1,
  XOM: 0.8,
  JNJ: 0.6,
  SPY: 1.0,
  QQQ: 1.1,
  KO: 0.55,
  PG: 0.45,
};

const MAX_DRAWDOWN_PLACEHOLDER = -18.6;

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeRiskReport(snapshot: PortfolioSnapshot): RiskReport {
  const { holdings, totalValue, investedValue, cash } = snapshot;

  const weights = holdings
    .map((h) => (totalValue > 0 ? (h.marketValue / totalValue) * 100 : 0))
    .sort((a, b) => b - a);

  const largestPositionPercent = round(weights[0] ?? 0);
  const positionConcentration = round(
    weights.slice(0, 3).reduce((s, w) => s + w, 0),
  );

  const sectorTotals = new Map<string, number>();
  for (const h of holdings) {
    sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + h.marketValue);
  }
  const topSector = Math.max(0, ...sectorTotals.values());
  const sectorConcentration = round(
    totalValue > 0 ? (topSector / totalValue) * 100 : 0,
  );

  const cashExposure = round(totalValue > 0 ? (cash / totalValue) * 100 : 0);

  const estimatedBeta =
    investedValue > 0
      ? round(
          holdings.reduce(
            (s, h) =>
              s + (BETA_MAP[h.symbol.toUpperCase()] ?? 1.0) * h.marketValue,
            0,
          ) / investedValue,
        )
      : 1.0;

  // Weighted blend of the risk drivers. Concentration and beta push the score
  // up; a healthy cash buffer pulls it down.
  const concentrationRisk = clamp(largestPositionPercent * 2.2, 0, 100);
  const sectorRisk = clamp(sectorConcentration, 0, 100);
  const betaRisk = clamp(estimatedBeta * 50, 0, 100);
  const drawdownRisk = clamp(Math.abs(MAX_DRAWDOWN_PLACEHOLDER) * 2, 0, 100);
  const cashBuffer = clamp(cashExposure, 0, 100);

  const raw =
    0.3 * concentrationRisk +
    0.25 * sectorRisk +
    0.2 * betaRisk +
    0.15 * drawdownRisk -
    0.1 * cashBuffer;
  const overallRiskScore = clamp(Math.round(raw), 0, 100);

  const riskLevel: RiskReport["riskLevel"] =
    overallRiskScore < 34 ? "low" : overallRiskScore < 67 ? "moderate" : "high";

  return {
    positionConcentration,
    largestPositionPercent,
    sectorConcentration,
    cashExposure,
    estimatedBeta,
    estimatedBetaIsPlaceholder: true,
    maxDrawdown: MAX_DRAWDOWN_PLACEHOLDER,
    maxDrawdownIsPlaceholder: true,
    overallRiskScore,
    riskLevel,
  };
}
