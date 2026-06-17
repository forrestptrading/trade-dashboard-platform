import { useGetAccountActivity } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Activity() {
  const { data: activityRes, isLoading } = useGetAccountActivity({ limit: 100 });
  const activities = activityRes?.data || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Activity</h1>
        <p className="text-muted-foreground font-mono text-sm">TRANSACTION HISTORY</p>
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
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase">Date</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase">Type</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase">Description</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Amount</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground tracking-wider uppercase text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((act) => (
                  <TableRow key={act.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {new Date(act.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-xs rounded-sm border-border uppercase ${act.type === 'buy' ? 'text-primary' : act.type === 'sell' ? 'text-destructive' : 'text-foreground'}`}>
                        {act.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {act.symbol ? (
                        <div>
                          <span className="font-mono text-primary font-medium mr-2">{act.symbol}</span>
                          <span className="text-sm text-muted-foreground">
                            {act.quantity} shs @ {formatCurrency(act.price || 0)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm">{act.description}</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-medium ${['buy', 'withdrawal'].includes(act.type) ? 'text-foreground' : 'text-primary'}`}>
                      {['buy', 'withdrawal'].includes(act.type) ? '-' : '+'}{formatCurrency(act.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                       <span className={`font-mono text-xs uppercase ${act.status === 'completed' ? 'text-muted-foreground' : 'text-accent animate-pulse'}`}>
                         {act.status}
                       </span>
                    </TableCell>
                  </TableRow>
                ))}
                {activities.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground font-mono">
                      NO ACTIVITY FOUND
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
