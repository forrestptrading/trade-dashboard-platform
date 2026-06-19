import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, CheckSquare, LayoutDashboard, LineChart, ListTree, LogOut } from "lucide-react";
import { useGetHealth, useGetQuotes } from "@workspace/api-client-react";

function TickerTape() {
  const { data: quotesRes } = useGetQuotes({ symbols: "SPY,QQQ,DIA,IWM,AAPL,MSFT,GOOGL,TSLA,NVDA,META" });
  const quotes = quotesRes?.data || [];

  if (!quotes.length) return null;

  return (
    <div className="flex-none h-8 border-b border-border bg-card/50 overflow-hidden flex items-center">
      <div className="flex gap-8 px-4 animate-[marquee_30s_linear_infinite] whitespace-nowrap font-mono text-xs">
        {quotes.map(q => (
          <div key={q.symbol} className="flex gap-2 items-center">
            <span className="font-semibold text-muted-foreground">{q.symbol}</span>
            <span>{q.price.toFixed(2)}</span>
            <span className={q.changePercent >= 0 ? "text-primary" : "text-destructive"}>
              {q.changePercent >= 0 ? "+" : ""}{(q.changePercent).toFixed(2)}%
            </span>
          </div>
        ))}
        {/* Duplicate for infinite effect */}
        {quotes.map(q => (
          <div key={`${q.symbol}-dup`} className="flex gap-2 items-center">
            <span className="font-semibold text-muted-foreground">{q.symbol}</span>
            <span>{q.price.toFixed(2)}</span>
            <span className={q.changePercent >= 0 ? "text-primary" : "text-destructive"}>
              {q.changePercent >= 0 ? "+" : ""}{(q.changePercent).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useGetHealth();

  const navItems = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/positions", label: "Positions", icon: LineChart },
    { href: "/watchlist", label: "Watchlist", icon: ListTree },
    { href: "/activity", label: "Activity", icon: Activity },
    { href: "/approvals", label: "Approvals", icon: CheckSquare },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className="w-64 border-r border-border bg-card flex flex-col justify-between">
        <div>
          <div className="p-6">
            <h1 className="text-xl font-bold tracking-tight text-primary">TERMINAL<span className="text-muted-foreground">/01</span></h1>
          </div>
          <nav className="space-y-1 px-3">
            {navItems.map((item) => {
              const active = location === item.href;
              return (
                <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-4 px-2">
            <span>SYS STATUS</span>
            <span className={`flex items-center gap-1.5 ${health?.status === 'ok' ? 'text-primary' : 'text-destructive'}`}>
              <span className={`h-2 w-2 rounded-full ${health?.status === 'ok' ? 'bg-primary' : 'bg-destructive'}`}></span>
              {health?.status === 'ok' ? 'ONLINE' : 'DEGRADED'}
            </span>
          </div>
          <Link href="/login" className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted">
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </Link>
        </div>
      </aside>
      
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        <TickerTape />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-7xl mx-auto h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
