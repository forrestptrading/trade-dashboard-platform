import { useGetWatchlist, useRefreshQuotes } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Watchlist() {
  const { data: watchlistRes, isLoading, refetch } = useGetWatchlist();
  const refreshQuotes = useRefreshQuotes();
  const items = watchlistRes?.data || [];

  const handleRefresh = async () => {
    await refreshQuotes.mutateAsync({});
    refetch();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
          <p className="text-muted-foreground font-mono text-sm">TRACKED EQUITIES</p>
        </div>
        <Button 
          onClick={handleRefresh} 
          disabled={refreshQuotes.isPending}
          variant="outline"
          className="border-border bg-card hover:bg-muted font-mono uppercase text-xs tracking-wider"
        >
          <RefreshCw className={`h-3 w-3 mr-2 ${refreshQuotes.isPending ? 'animate-spin' : ''}`} />
          Refresh Prices
        </Button>
      </div>

      <Card className="bg-card border-border flex-1 overflow-hidden flex flex-col">
        <CardContent className="p-0 overflow-auto">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase">Symbol</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Price</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Day Chg</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">52W Range</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Vol / Cap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="font-mono text-primary font-medium">{item.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">{item.name}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-base">{formatCurrency(item.current_price)}</TableCell>
                    <TableCell className={`text-right font-mono ${item.day_change >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {item.day_change >= 0 ? '+' : ''}{formatCurrency(item.day_change)}
                      <div className="text-xs opacity-80">{item.day_change_percent >= 0 ? '+' : ''}{formatPercent(item.day_change_percent)}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <div>{formatCurrency(item.week_52_high)} H</div>
                      <div className="text-muted-foreground">{formatCurrency(item.week_52_low)} L</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <div>{(item.volume / 1000000).toFixed(1)}M Vol</div>
                      <div className="text-muted-foreground">{item.market_cap}</div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground font-mono">
                      NO WATCHLIST ITEMS
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
