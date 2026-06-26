import { useGetPortfolio, useGetMarketSummary, useGetAccountActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  AnalyticsSection,
  RiskSection,
  PerformanceSection,
  AiTradeQueueSection,
  NotificationsSection,
} from "@/components/analytics-sections";

export default function Dashboard() {
  const { data: portfolioRes, isLoading: isPortfolioLoading } = useGetPortfolio();
  const { data: marketRes, isLoading: isMarketLoading } = useGetMarketSummary();
  const { data: activityRes, isLoading: isActivityLoading } = useGetAccountActivity({ limit: 5 });

  const portfolio = portfolioRes?.data;
  const market = marketRes?.data;
  const activities = activityRes?.data || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground font-mono text-sm">PORTFOLIO SUMMARY & MARKET STATUS</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="col-span-1 md:col-span-2 bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Total Value</CardTitle>
          </CardHeader>
          <CardContent>
            {isPortfolioLoading ? (
              <Skeleton className="h-12 w-48 mb-2" />
            ) : (
              <div className="flex items-baseline gap-4">
                <span className="text-5xl font-mono font-medium tracking-tight">
                  {formatCurrency(portfolio?.total_value || 0)}
                </span>
                <div className={`flex items-center text-lg font-mono ${portfolio && portfolio.day_change >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {portfolio && portfolio.day_change >= 0 ? '+' : ''}
                  {formatCurrency(portfolio?.day_change || 0)} 
                  <span className="ml-2 text-sm opacity-80">
                    ({portfolio && portfolio.day_change_percent >= 0 ? '+' : ''}{formatPercent(portfolio?.day_change_percent || 0)})
                  </span>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/50">
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-1 uppercase">Cash</p>
                <p className="font-mono text-sm">{formatCurrency(portfolio?.cash || 0)}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-1 uppercase">Invested</p>
                <p className="font-mono text-sm">{formatCurrency(portfolio?.invested_value || 0)}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-1 uppercase">Buying Power</p>
                <p className="font-mono text-sm">{formatCurrency(portfolio?.buying_power || 0)}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-1 uppercase">Total Return</p>
                <p className={`font-mono text-sm ${portfolio && portfolio.total_return >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {portfolio && portfolio.total_return >= 0 ? '+' : ''}
                  {formatCurrency(portfolio?.total_return || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Market Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isMarketLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase">{market?.market.status}</span>
                  <span className="text-xs text-muted-foreground">{market?.market.message}</span>
                </div>
                
                <div className="space-y-3">
                  {market?.indices.map((idx) => (
                    <div key={idx.symbol} className="flex justify-between items-center text-sm font-mono border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <span>{idx.symbol}</span>
                      <div className="flex gap-4 text-right">
                        <span>{idx.price.toFixed(2)}</span>
                        <span className={`w-16 ${idx.changePercent >= 0 ? 'text-primary' : 'text-destructive'}`}>
                          {idx.changePercent >= 0 ? '+' : ''}{formatPercent(idx.changePercent)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Top Movers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isMarketLoading ? (
               <div className="p-6"><Skeleton className="h-32 w-full" /></div>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="p-4 space-y-3">
                  <p className="text-xs font-mono text-primary mb-2 uppercase tracking-wider">Gainers</p>
                  {market?.movers.gainers.map((m) => (
                    <div key={m.symbol} className="flex justify-between items-center text-sm font-mono">
                      <span>{m.symbol}</span>
                      <span className="text-primary">+{formatPercent(m.changePercent)}</span>
                    </div>
                  ))}
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-xs font-mono text-destructive mb-2 uppercase tracking-wider">Losers</p>
                  {market?.movers.losers.map((m) => (
                    <div key={m.symbol} className="flex justify-between items-center text-sm font-mono">
                      <span>{m.symbol}</span>
                      <span className="text-destructive">{formatPercent(m.changePercent)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
             {isActivityLoading ? (
               <div className="p-6"><Skeleton className="h-32 w-full" /></div>
            ) : (
              <div className="divide-y divide-border/50">
                {activities.map((act) => (
                  <div key={act.id} className="p-3 px-4 flex justify-between items-center hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="text-sm font-medium">
                        <span className="uppercase text-muted-foreground text-xs font-mono mr-2">{act.type}</span>
                        {act.symbol ? <span className="font-mono text-primary">{act.symbol}</span> : act.description}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(act.date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono text-sm ${['buy', 'withdrawal'].includes(act.type) ? 'text-foreground' : 'text-primary'}`}>
                         {['buy', 'withdrawal'].includes(act.type) ? '-' : '+'}{formatCurrency(act.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground uppercase font-mono">{act.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="border-t border-border/50 pt-8 space-y-10">
        <AnalyticsSection />
        <RiskSection />
        <PerformanceSection />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          <AiTradeQueueSection />
          <NotificationsSection />
        </div>
      </div>
    </div>
  );
}
