import { useGetPositions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Positions() {
  const { data: positionsRes, isLoading } = useGetPositions();
  const positions = positionsRes?.data || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Positions</h1>
        <p className="text-muted-foreground font-mono text-sm">CURRENT HOLDINGS</p>
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
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Qty</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Avg Price</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Current</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Mkt Value</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Day Chg</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Total Ret</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">% of Port</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((pos) => (
                  <TableRow key={pos.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="font-mono text-primary font-medium">{pos.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">{pos.name}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{pos.quantity.toFixed(4)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(pos.average_buy_price)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(pos.current_price)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(pos.market_value)}</TableCell>
                    <TableCell className={`text-right font-mono ${pos.day_change >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {pos.day_change >= 0 ? '+' : ''}{formatCurrency(pos.day_change)}
                      <div className="text-xs opacity-80">{pos.day_change_percent >= 0 ? '+' : ''}{formatPercent(pos.day_change_percent)}</div>
                    </TableCell>
                    <TableCell className={`text-right font-mono ${pos.total_return >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {pos.total_return >= 0 ? '+' : ''}{formatCurrency(pos.total_return)}
                      <div className="text-xs opacity-80">{pos.total_return_percent >= 0 ? '+' : ''}{formatPercent(pos.total_return_percent)}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(pos.percent_of_portfolio)}</TableCell>
                  </TableRow>
                ))}
                {positions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground font-mono">
                      NO ACTIVE POSITIONS
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
