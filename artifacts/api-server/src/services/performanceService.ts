/**
 * Performance Service.
 *
 * Returns daily / weekly / monthly / yearly performance. Live brokers do not
 * yet expose complete historical equity curves through the abstraction, so this
 * returns mock values. The shape is stable so the route never changes once live
 * history is wired in.
 */

export type PerformancePeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface PerformanceEntry {
  period: PerformancePeriod;
  returnValue: number;
  returnPercent: number;
  startValue: number;
  endValue: number;
  high: number;
  low: number;
  bestDay: { date: string; percent: number };
  worstDay: { date: string; percent: number };
}

export interface PerformanceReport {
  isPlaceholder: boolean;
  baseCurrency: string;
  asOf: string;
  periods: Record<PerformancePeriod, PerformanceEntry>;
}

const MOCK: Record<PerformancePeriod, PerformanceEntry> = {
  daily: {
    period: "daily",
    returnValue: 412.34,
    returnPercent: 0.79,
    startValue: 51929.53,
    endValue: 52341.87,
    high: 52610.12,
    low: 51820.4,
    bestDay: { date: "2026-06-26", percent: 0.79 },
    worstDay: { date: "2026-06-26", percent: 0.79 },
  },
  weekly: {
    period: "weekly",
    returnValue: 1284.91,
    returnPercent: 2.52,
    startValue: 51056.96,
    endValue: 52341.87,
    high: 52610.12,
    low: 50710.33,
    bestDay: { date: "2026-06-24", percent: 1.41 },
    worstDay: { date: "2026-06-22", percent: -0.68 },
  },
  monthly: {
    period: "monthly",
    returnValue: 3187.42,
    returnPercent: 6.48,
    startValue: 49154.45,
    endValue: 52341.87,
    high: 52980.55,
    low: 48420.18,
    bestDay: { date: "2026-06-11", percent: 2.03 },
    worstDay: { date: "2026-06-05", percent: -1.74 },
  },
  yearly: {
    period: "yearly",
    returnValue: 9841.23,
    returnPercent: 23.16,
    startValue: 42500.64,
    endValue: 52341.87,
    high: 53980.21,
    low: 39870.5,
    bestDay: { date: "2025-11-14", percent: 3.42 },
    worstDay: { date: "2025-08-05", percent: -4.11 },
  },
};

export function getPerformanceReport(): PerformanceReport {
  return {
    isPlaceholder: true,
    baseCurrency: "USD",
    asOf: new Date().toISOString(),
    periods: MOCK,
  };
}

export function isPerformancePeriod(value: string): value is PerformancePeriod {
  return (
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly"
  );
}
