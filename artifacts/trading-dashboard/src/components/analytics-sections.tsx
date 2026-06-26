import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  usePortfolioAnalytics,
  useRiskMetrics,
  usePerformance,
  useAiTrades,
  useNotifications,
  type AllocationSlice,
  type PositionHighlight,
  type PerformanceEntry,
  type PerformancePeriodKey,
} from "@/lib/trading-api";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="text-muted-foreground font-mono text-xs uppercase tracking-wider">{subtitle}</p>
    </div>
  );
}

/** Graceful fallback shown whenever a Sprint-3 endpoint fails. */
function SectionError({ label }: { label: string }) {
  return (
    <Card className="bg-card border-destructive/40">
      <CardContent className="flex items-center gap-3 py-6">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
        <div>
          <p className="text-sm font-medium text-destructive">Couldn't load {label}</p>
          <p className="text-xs text-muted-foreground">
            The service is unavailable right now. Other sections are unaffected — try refreshing later.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </div>
  );
}

function AllocationList({ slices }: { slices: AllocationSlice[] }) {
  if (!slices.length) {
    return <p className="text-xs text-muted-foreground font-mono">No data</p>;
  }
  return (
    <div className="space-y-3">
      {slices.slice(0, 6).map((s) => (
        <div key={s.key} className="space-y-1">
          <div className="flex justify-between items-baseline text-xs font-mono">
            <span className="truncate pr-2">{s.key}</span>
            <span className="text-muted-foreground tabular-nums">{formatPercent(s.percent)}</span>
          </div>
          <Bar percent={s.percent} />
        </div>
      ))}
    </div>
  );
}

function HighlightRow({ label, h }: { label: string; h: PositionHighlight | null }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
      <span className="text-xs font-mono text-muted-foreground uppercase">{label}</span>
      {h ? (
        <div className="text-right">
          <p className="text-sm font-mono font-medium">{h.symbol}</p>
          <p className={`text-xs font-mono ${h.unrealizedPL >= 0 ? "text-primary" : "text-destructive"}`}>
            {h.unrealizedPL >= 0 ? "+" : ""}
            {formatCurrency(h.unrealizedPL)} ({h.unrealizedPL >= 0 ? "+" : ""}
            {formatPercent(h.unrealizedPLPercent)})
          </p>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground font-mono">—</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Portfolio analytics
// ---------------------------------------------------------------------------

export function AnalyticsSection() {
  const { data: res, isLoading, isError } = usePortfolioAnalytics();
  const a = res?.data;

  return (
    <section id="section-analytics" className="dashboard-section space-y-4">
      <SectionHeader title="Portfolio Analytics" subtitle="Allocation & concentration" />
      {isError ? (
        <SectionError label="portfolio analytics" />
      ) : isLoading || !a ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Cash vs Invested
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm font-mono">
                <span className="text-muted-foreground">Cash</span>
                <span className="tabular-nums">{formatPercent(a.cashPercentage)}</span>
              </div>
              <Bar percent={a.cashPercentage} />
              <div className="flex justify-between text-sm font-mono">
                <span className="text-muted-foreground">Invested</span>
                <span className="tabular-nums">{formatPercent(a.investedPercentage)}</span>
              </div>
              <Bar percent={a.investedPercentage} />
              <div className="pt-3 mt-2 border-t border-border/50 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase">Diversification</p>
                  <p className="text-2xl font-mono font-medium tabular-nums">{a.diversificationScore}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase">Positions</p>
                  <p className="text-2xl font-mono font-medium tabular-nums">{a.positionCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Position Highlights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HighlightRow label="Largest" h={a.largestPosition} />
              <HighlightRow label="Top Gain" h={a.largestGain} />
              <HighlightRow label="Top Loss" h={a.largestLoss} />
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Allocation by Sector
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationList slices={a.allocationBySector} />
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Allocation by Asset
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationList slices={a.allocationByAsset} />
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Allocation by Broker
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationList slices={a.allocationByBroker} />
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Risk metrics
// ---------------------------------------------------------------------------

function riskLevelClass(level: string) {
  if (level === "low") return "bg-primary/15 text-primary border-primary/30";
  if (level === "high") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

function RiskMetric({
  label,
  value,
  placeholder,
}: {
  label: string;
  value: string;
  placeholder?: boolean;
}) {
  return (
    <div className="border-b border-border/50 py-2 last:border-0">
      <p className="text-[10px] font-mono text-muted-foreground uppercase flex items-center gap-1">
        {label}
        {placeholder && (
          <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground">est</span>
        )}
      </p>
      <p className="text-sm font-mono tabular-nums">{value}</p>
    </div>
  );
}

export function RiskSection() {
  const { data: res, isLoading, isError } = useRiskMetrics();
  const r = res?.data;

  return (
    <section id="section-risk" className="dashboard-section space-y-4">
      <SectionHeader title="Risk Metrics" subtitle="Exposure & concentration risk" />
      {isError ? (
        <SectionError label="risk metrics" />
      ) : isLoading || !r ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border md:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Overall Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-mono font-medium tabular-nums">{r.overallRiskScore}</span>
                <span className="text-xs text-muted-foreground font-mono">/ 100</span>
              </div>
              <Badge variant="outline" className={`font-mono uppercase ${riskLevelClass(r.riskLevel)}`}>
                {r.riskLevel} risk
              </Badge>
              <Bar percent={r.overallRiskScore} />
            </CardContent>
          </Card>

          <Card className="bg-card border-border md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-8">
              <RiskMetric label="Largest Position" value={formatPercent(r.largestPositionPercent)} />
              <RiskMetric label="Sector Concentration" value={formatPercent(r.sectorConcentration)} />
              <RiskMetric label="Cash Exposure" value={formatPercent(r.cashExposure)} />
              <RiskMetric label="Top-3 Concentration" value={formatPercent(r.positionConcentration)} />
              <RiskMetric
                label="Beta"
                value={r.estimatedBeta.toFixed(2)}
                placeholder={r.estimatedBetaIsPlaceholder}
              />
              <RiskMetric
                label="Max Drawdown"
                value={formatPercent(r.maxDrawdown)}
                placeholder={r.maxDrawdownIsPlaceholder}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Performance
// ---------------------------------------------------------------------------

const PERIOD_LABELS: Record<PerformancePeriodKey, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function PerformanceCard({ entry }: { entry: PerformanceEntry }) {
  const positive = entry.returnPercent >= 0;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {PERIOD_LABELS[entry.period]}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className={`text-2xl font-mono font-medium tabular-nums ${positive ? "text-primary" : "text-destructive"}`}>
          {positive ? "+" : ""}
          {formatPercent(entry.returnPercent)}
        </p>
        <p className={`text-xs font-mono ${positive ? "text-primary" : "text-destructive"}`}>
          {positive ? "+" : ""}
          {formatCurrency(entry.returnValue)}
        </p>
        <div className="pt-2 mt-1 border-t border-border/50 grid grid-cols-2 gap-1 text-[10px] font-mono text-muted-foreground">
          <span>H {formatCurrency(entry.high)}</span>
          <span className="text-right">L {formatCurrency(entry.low)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceSection() {
  const { data: res, isLoading, isError } = usePerformance();
  const periods = res?.data;

  return (
    <section id="section-performance" className="dashboard-section space-y-4">
      <SectionHeader title="Performance" subtitle="Returns across periods" />
      {isError ? (
        <SectionError label="performance" />
      ) : isLoading || !periods ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(Object.keys(PERIOD_LABELS) as PerformancePeriodKey[]).map((key) => (
              <PerformanceCard key={key} entry={periods[key]} />
            ))}
          </div>
          {res?.isPlaceholder && (
            <p className="text-[10px] font-mono text-muted-foreground">
              * Indicative figures — brokers don't expose historical performance yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. AI trade queue
// ---------------------------------------------------------------------------

function tradeStatusClass(status: string) {
  switch (status) {
    case "Approved":
      return "bg-primary/15 text-primary border-primary/30";
    case "Executed":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "Rejected":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  }
}

export function AiTradeQueueSection() {
  const { data: res, isLoading, isError } = useAiTrades();
  const trades = res?.data ?? [];

  return (
    <section id="section-ai-trades" className="dashboard-section space-y-4">
      <SectionHeader title="AI Command Center" subtitle="AI trade queue" />
      {isError ? (
        <SectionError label="the AI trade queue" />
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          <CardContent className="p-0">
            {trades.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground font-mono">No AI trade ideas in the queue.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {trades.map((t) => (
                  <div
                    key={t.id}
                    className="ai-trade-row p-4 flex items-center justify-between gap-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-primary">{t.ticker}</span>
                        <Badge variant="outline" className={`font-mono text-[10px] uppercase ${riskLevelClass(t.risk === "medium" ? "moderate" : t.risk)}`}>
                          {t.risk}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{t.strategy}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {new Date(t.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase ${tradeStatusClass(t.status)}`}>
                        {t.status}
                      </Badge>
                      <p className="text-xs font-mono text-muted-foreground tabular-nums">
                        conf {t.confidence}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. Notifications
// ---------------------------------------------------------------------------

function severityClass(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "warning":
    case "medium":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function NotificationsSection() {
  const { data: res, isLoading, isError } = useNotifications();
  const notifications = res?.data ?? [];

  return (
    <section id="section-notifications" className="dashboard-section space-y-4">
      <SectionHeader title="Notifications" subtitle="Alerts & signals" />
      {isError ? (
        <SectionError label="notifications" />
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          <CardContent className="p-0">
            {notifications.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground font-mono">No notifications.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`notification-row p-4 flex items-start justify-between gap-4 hover:bg-muted/50 transition-colors ${n.status === "unread" ? "bg-primary/5" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{n.title}</span>
                        {n.status === "unread" && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{n.message}</p>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase mt-1 inline-block">
                        {n.type}
                      </span>
                    </div>
                    <Badge variant="outline" className={`font-mono text-[10px] uppercase shrink-0 ${severityClass(n.severity)}`}>
                      {n.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
