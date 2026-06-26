import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

/**
 * Sprint 4 frontend API layer for the Sprint 3 backend endpoints.
 *
 * These endpoints are not part of the generated OpenAPI client, so they are
 * called here directly through the shared `customFetch` utility (same base-URL
 * and auth handling as the generated hooks). All reads use `optionalAuth` on
 * the backend, so anonymous callers still receive demo (`source: "mock"`) data.
 *
 * CACHE_VERSION namespaces every query key below. Bump it whenever a response
 * shape changes so stale React Query cache entries are discarded on deploy.
 */
export const CACHE_VERSION = "v1";

// ---------------------------------------------------------------------------
// Shared response envelope
// ---------------------------------------------------------------------------

export interface ApiEnvelope<T> {
  success: boolean;
  source?: "db" | "mock";
  data: T;
  count?: number;
  unread?: number;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export interface RiskMetrics {
  positionConcentration: number;
  largestPositionPercent: number;
  sectorConcentration: number;
  cashExposure: number;
  estimatedBeta: number;
  estimatedBetaIsPlaceholder: boolean;
  maxDrawdown: number;
  maxDrawdownIsPlaceholder: boolean;
  overallRiskScore: number;
  riskLevel: "low" | "moderate" | "high";
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export type PerformancePeriodKey = "daily" | "weekly" | "monthly" | "yearly";

export interface PerformanceEntry {
  period: PerformancePeriodKey;
  returnValue: number;
  returnPercent: number;
  startValue: number;
  endValue: number;
  high: number;
  low: number;
  bestDay: { date: string; percent: number };
  worstDay: { date: string; percent: number };
}

/**
 * The performance endpoint flattens its envelope: `data` is the periods record
 * itself, and `isPlaceholder` / `asOf` live on the top-level response.
 */
export interface PerformanceResponse {
  success: boolean;
  source?: "db" | "mock";
  isPlaceholder: boolean;
  asOf: string;
  baseCurrency?: string;
  data: Record<PerformancePeriodKey, PerformanceEntry>;
}

// ---------------------------------------------------------------------------
// AI trade queue
// ---------------------------------------------------------------------------

export interface AiTrade {
  id: string;
  ticker: string;
  strategy: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  status: "Pending" | "Approved" | "Rejected" | "Executed";
  rationale: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface AppNotification {
  id: string;
  type: string;
  symbol: string | null;
  title: string;
  message: string;
  severity: string;
  status: "unread" | "read" | "dismissed";
  metadata?: unknown;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Fetch functions (required by Sprint 4)
// ---------------------------------------------------------------------------

export async function fetchPortfolioAnalytics(
  broker?: string,
): Promise<ApiEnvelope<PortfolioAnalytics>> {
  const qs = broker ? `?broker=${encodeURIComponent(broker)}` : "";
  return customFetch<ApiEnvelope<PortfolioAnalytics>>(`/api/analytics/portfolio${qs}`, {
    method: "GET",
    responseType: "json",
  });
}

export async function fetchRiskMetrics(
  broker?: string,
): Promise<ApiEnvelope<RiskMetrics>> {
  const qs = broker ? `?broker=${encodeURIComponent(broker)}` : "";
  return customFetch<ApiEnvelope<RiskMetrics>>(`/api/risk${qs}`, {
    method: "GET",
    responseType: "json",
  });
}

export async function fetchPerformance(): Promise<PerformanceResponse> {
  return customFetch<PerformanceResponse>(`/api/performance`, {
    method: "GET",
    responseType: "json",
  });
}

export async function fetchAiTrades(): Promise<ApiEnvelope<AiTrade[]>> {
  return customFetch<ApiEnvelope<AiTrade[]>>(`/api/ai/trades`, {
    method: "GET",
    responseType: "json",
  });
}

export async function fetchNotifications(): Promise<ApiEnvelope<AppNotification[]>> {
  return customFetch<ApiEnvelope<AppNotification[]>>(`/api/notifications`, {
    method: "GET",
    responseType: "json",
  });
}

// ---------------------------------------------------------------------------
// Thin React Query hooks used by the dashboard
// ---------------------------------------------------------------------------

export function usePortfolioAnalytics() {
  return useQuery({
    queryKey: [CACHE_VERSION, "/api/analytics/portfolio"],
    queryFn: () => fetchPortfolioAnalytics(),
  });
}

export function useRiskMetrics() {
  return useQuery({
    queryKey: [CACHE_VERSION, "/api/risk"],
    queryFn: () => fetchRiskMetrics(),
  });
}

export function usePerformance() {
  return useQuery({
    queryKey: [CACHE_VERSION, "/api/performance"],
    queryFn: () => fetchPerformance(),
  });
}

export function useAiTrades() {
  return useQuery({
    queryKey: [CACHE_VERSION, "/api/ai/trades"],
    queryFn: () => fetchAiTrades(),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: [CACHE_VERSION, "/api/notifications"],
    queryFn: () => fetchNotifications(),
  });
}
