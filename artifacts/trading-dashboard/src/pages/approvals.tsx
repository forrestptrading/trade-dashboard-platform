import { useState } from "react";
import {
  useGetApprovalsHistory,
  useGetApprovalsPending,
  useApproveApproval,
  useRejectApproval,
  useCreateApproval,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle, ChevronDown, ChevronUp, XCircle, Clock, Plus } from "lucide-react";

type Approval = {
  id: string;
  type: string;
  symbol: string;
  name: string;
  quantity: number;
  estimated_price: number;
  estimated_total: number;
  submitted_at: string;
  expires_at: string;
  status: "pending_approval" | "approved" | "rejected";
  reason: string;
  requested_by: string;
  resolved_at?: string | null;
  resolved_note?: string | null;
};

function StatusBadge({ status }: { status: Approval["status"] }) {
  if (status === "approved")
    return (
      <Badge className="bg-primary/20 text-primary border-primary/30 font-mono text-xs uppercase gap-1">
        <CheckCircle className="h-3 w-3" /> Approved
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge className="bg-destructive/20 text-destructive border-destructive/30 font-mono text-xs uppercase gap-1">
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );
  return (
    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 font-mono text-xs uppercase gap-1">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

function ApprovalRow({
  approval,
  showActions,
}: {
  approval: Approval;
  showActions: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/approvals/history"] });
    queryClient.invalidateQueries({ queryKey: ["/approvals/pending"] });
  };

  const approveMutation = useApproveApproval({
    mutation: {
      onMutate: () => setActing("approve"),
      onSuccess: (res) => {
        invalidate();
        toast({
          title: "Trade approved",
          description: `${res.data.symbol} — ${res.message}`,
        });
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Could not approve trade";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
      onSettled: () => setActing(null),
    },
  });

  const rejectMutation = useRejectApproval({
    mutation: {
      onMutate: () => setActing("reject"),
      onSuccess: (res) => {
        invalidate();
        toast({
          title: "Trade rejected",
          description: `${res.data.symbol} — ${res.message}`,
          variant: "destructive",
        });
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Could not reject trade";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
      onSettled: () => setActing(null),
    },
  });

  const handleApprove = () =>
    approveMutation.mutate({ id: approval.id, data: {} });
  const handleReject = () =>
    rejectMutation.mutate({ id: approval.id, data: {} });

  const isBusy = acting !== null;

  return (
    <div className="p-4 flex flex-col gap-3 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm font-semibold text-primary">
              {approval.symbol}
            </span>
            <span className="font-mono text-xs uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {approval.type}
            </span>
            <StatusBadge status={approval.status} />
          </div>
          <p className="text-sm text-muted-foreground truncate">{approval.name}</p>
        </div>

        <div className="text-right shrink-0">
          <p className="font-mono text-sm font-medium">
            {formatCurrency(approval.estimated_total)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {approval.quantity} × {formatCurrency(approval.estimated_price)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground font-mono">
          <span>Reason: {approval.reason}</span>
          <span>
            Submitted:{" "}
            {new Date(approval.submitted_at).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </span>
          {approval.resolved_at && (
            <span>
              Resolved:{" "}
              {new Date(approval.resolved_at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {approval.resolved_note ? ` — ${approval.resolved_note}` : ""}
            </span>
          )}
        </div>

        {showActions && approval.status === "pending_approval" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive font-mono text-xs h-7 px-3"
              disabled={isBusy}
              onClick={handleReject}
            >
              {acting === "reject" ? "Rejecting…" : "Reject"}
            </Button>
            <Button
              size="sm"
              className="bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 font-mono text-xs h-7 px-3"
              disabled={isBusy}
              onClick={handleApprove}
            >
              {acting === "approve" ? "Approving…" : "Approve"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-border/50">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-4 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

const MOCK_APPROVALS: Approval[] = [
  {
    id: "local-001",
    type: "buy",
    symbol: "AAPL",
    name: "Apple Inc.",
    quantity: 10,
    estimated_price: 189.5,
    estimated_total: 1895.0,
    submitted_at: new Date(Date.now() - 60000 * 10).toISOString(),
    expires_at: new Date(Date.now() + 60000 * 50).toISOString(),
    status: "pending_approval",
    reason: "Portfolio rebalance",
    requested_by: "system",
    resolved_at: null,
    resolved_note: null,
  },
];

const BLANK_FORM = {
  symbol: "",
  action: "BUY",
  assetType: "SHARES",
  quantity: "",
  strike: "",
  expiration: "",
  estimatedCost: "",
  note: "",
};

function SubmitTradeForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  const createMutation = useCreateApproval({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: ["/approvals/pending"] });
        queryClient.invalidateQueries({ queryKey: ["/approvals/history"] });
        toast({
          title: "Request submitted",
          description: `${res.data.symbol} ${res.data.type.toUpperCase()} queued for approval — mock only.`,
        });
        setForm(BLANK_FORM);
        setOpen(false);
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Submission failed";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const set = (key: keyof typeof BLANK_FORM) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(form.quantity);
    const cost = Number(form.estimatedCost);
    if (!form.symbol || !qty || !cost) return;
    createMutation.mutate({
      data: {
        symbol: form.symbol.toUpperCase(),
        action: form.action.toLowerCase(),
        assetType: form.assetType,
        quantity: qty,
        estimatedCost: cost,
        strike: form.strike ? Number(form.strike) : undefined,
        expiration: form.expiration || undefined,
        note: form.note || undefined,
        source: "manual_dashboard",
      },
    });
  };

  const needsOptionsFields = form.assetType === "CALL" || form.assetType === "PUT";

  return (
    <Card className="bg-card border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-medium">Submit Trade Request</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <>
          <div className="mx-5 mb-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/25 flex items-center gap-2">
            <span className="text-yellow-400 font-mono text-xs">⚠ Mock trade request — not sent to broker</span>
          </div>

          <form onSubmit={handleSubmit}>
            <CardContent className="pt-0 pb-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Symbol *</Label>
                  <Input
                    placeholder="e.g. AAPL"
                    value={form.symbol}
                    onChange={(e) => set("symbol")(e.target.value.toUpperCase())}
                    className="font-mono uppercase bg-background border-border h-8 text-sm"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Action *</Label>
                  <Select value={form.action} onValueChange={set("action")}>
                    <SelectTrigger className="bg-background border-border h-8 text-sm font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUY">BUY</SelectItem>
                      <SelectItem value="SELL">SELL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Asset Type *</Label>
                  <Select value={form.assetType} onValueChange={set("assetType")}>
                    <SelectTrigger className="bg-background border-border h-8 text-sm font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SHARES">SHARES</SelectItem>
                      <SelectItem value="CALL">CALL</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Quantity *</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="10"
                    value={form.quantity}
                    onChange={(e) => set("quantity")(e.target.value)}
                    className="font-mono bg-background border-border h-8 text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Estimated Cost *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="1500.00"
                    value={form.estimatedCost}
                    onChange={(e) => set("estimatedCost")(e.target.value)}
                    className="font-mono bg-background border-border h-8 text-sm"
                    required
                  />
                </div>

                {needsOptionsFields && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs uppercase text-muted-foreground">Strike</Label>
                      <Input
                        type="number"
                        step="0.5"
                        placeholder="200.00"
                        value={form.strike}
                        onChange={(e) => set("strike")(e.target.value)}
                        className="font-mono bg-background border-border h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs uppercase text-muted-foreground">Expiration</Label>
                      <Input
                        type="date"
                        value={form.expiration}
                        onChange={(e) => set("expiration")(e.target.value)}
                        className="font-mono bg-background border-border h-8 text-sm"
                      />
                    </div>
                  </>
                )}

                <div className={`space-y-1.5 ${needsOptionsFields ? "" : "md:col-span-3"}`}>
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Note</Label>
                  <Input
                    placeholder="Reason or signal description"
                    value={form.note}
                    onChange={(e) => set("note")(e.target.value)}
                    className="font-mono bg-background border-border h-8 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-xs text-muted-foreground">
                  source: <span className="text-foreground">manual_dashboard</span>
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="font-mono text-xs h-7"
                    onClick={() => { setForm(BLANK_FORM); setOpen(false); }}
                    disabled={createMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 font-mono text-xs h-7 px-4"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? "Submitting…" : "Submit Request"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </form>
        </>
      )}
    </Card>
  );
}

export default function Approvals() {
  const { data: historyRes, isLoading: isHistoryLoading, isError: isHistoryError } =
    useGetApprovalsHistory(
      {},
      { query: { refetchInterval: 30_000, refetchIntervalInBackground: false } },
    );
  const { data: pendingRes, isLoading: isPendingLoading, isError: isPendingError } =
    useGetApprovalsPending(
      {},
      { query: { refetchInterval: 30_000, refetchIntervalInBackground: false } },
    );

  const history = isHistoryError ? MOCK_APPROVALS : (historyRes?.data ?? []);
  const counts = isHistoryError
    ? { pending: MOCK_APPROVALS.length, approved: 0, rejected: 0 }
    : (historyRes?.counts ?? { pending: 0, approved: 0, rejected: 0 });
  const pending = isPendingError
    ? MOCK_APPROVALS
    : (pendingRes?.data ?? []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground font-mono text-sm">
          TRADE APPROVAL QUEUE & HISTORY
        </p>
      </div>

      <SubmitTradeForm />

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <p className="text-xs font-mono text-yellow-400 uppercase mb-1">Pending</p>
            <p className="text-3xl font-mono font-semibold">{counts.pending}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <p className="text-xs font-mono text-primary uppercase mb-1">Approved</p>
            <p className="text-3xl font-mono font-semibold">{counts.approved}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <p className="text-xs font-mono text-destructive uppercase mb-1">Rejected</p>
            <p className="text-3xl font-mono font-semibold">{counts.rejected}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="pending" className="font-mono text-xs uppercase">
            Pending ({counts.pending})
          </TabsTrigger>
          <TabsTrigger value="history" className="font-mono text-xs uppercase">
            All History ({historyRes?.count ?? history.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-2 border-b border-border">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Pending Approvals
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isPendingLoading ? (
                <LoadingRows />
              ) : pending.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm">
                  No pending approvals
                </div>
              ) : (
                <div>
                  {pending.map((a) => (
                    <ApprovalRow key={a.id} approval={a} showActions={true} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-2 border-b border-border">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                All Approvals
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isHistoryLoading ? (
                <LoadingRows />
              ) : history.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm">
                  No approval history
                </div>
              ) : (
                <div>
                  {history.map((a) => (
                    <ApprovalRow key={a.id} approval={a} showActions={true} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
