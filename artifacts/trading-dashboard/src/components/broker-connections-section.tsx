import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import {
  CACHE_VERSION,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  useBrokerConnections,
  useCreateBrokerConnection,
  useDeleteBrokerConnection,
  type BrokerConnection,
  type BrokerProvider,
} from "@/lib/trading-api";

declare global {
  interface Window {
    Plaid?: {
      create: (options: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit?: () => void;
      }) => { open: () => void };
    };
  }
}

const BROKERS: Array<{ provider: BrokerProvider; name: string }> = [
  { provider: "robinhood", name: "Robinhood" },
  { provider: "sofi", name: "SoFi" },
  { provider: "webull", name: "Webull" },
  { provider: "schwab", name: "Schwab" },
  { provider: "fidelity", name: "Fidelity" },
];

function statusClass(status: BrokerConnection["status"]) {
  switch (status) {
    case "connected":
      return "border-primary/30 bg-primary/10 text-primary";
    case "syncing":
      return "border-blue-500/30 bg-blue-500/10 text-blue-400";
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-muted bg-muted text-muted-foreground";
  }
}

export function BrokerConnectionsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useBrokerConnections();
  const connect = useCreateBrokerConnection();
  const disconnect = useDeleteBrokerConnection();
  const [message, setMessage] = useState<string | null>(null);
  const connections = data?.data ?? [];

  const refreshPortfolioData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] }),
      queryClient.invalidateQueries({ queryKey: [CACHE_VERSION, "/api/analytics/portfolio"] }),
      queryClient.invalidateQueries({ queryKey: [CACHE_VERSION, "/api/risk"] }),
    ]);
  };

  const loadPlaid = async (): Promise<boolean> => {
    if (window.Plaid) return true;

    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Plaid Link failed to load")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Plaid Link failed to load"));
      document.body.appendChild(script);
    });

    return Boolean(window.Plaid);
  };

  const connectDemo = async (provider: BrokerProvider) => {
    await connect.mutateAsync(provider);
    await refetch();
    await refreshPortfolioData();
  };

  const handleConnect = async (provider: BrokerProvider) => {
    setMessage(null);
    const tokenResponse = await createPlaidLinkToken(provider);

    if (!tokenResponse.configured || !tokenResponse.link_token) {
      setMessage(tokenResponse.message ?? "Plaid is not configured yet. Demo connection is available.");
      return;
    }

    const plaidAvailable = await loadPlaid().catch(() => false);
    if (!plaidAvailable || !window.Plaid) {
      setMessage("Plaid is not configured yet. Demo connection is available.");
      return;
    }

    const handler = window.Plaid.create({
      token: tokenResponse.link_token,
      onSuccess: async (publicToken) => {
        await exchangePlaidPublicToken({ provider, public_token: publicToken });
        await refetch();
        await refreshPortfolioData();
      },
      onExit: () => {
        setMessage("Plaid Link was closed. Demo connection is available.");
      },
    });

    handler.open();
  };

  const handleDisconnect = async (connectionId: string) => {
    await disconnect.mutateAsync(connectionId);
    await refetch();
    await refreshPortfolioData();
  };

  const handleRefresh = async () => {
    await refetch();
    await refreshPortfolioData();
  };

  return (
    <section id="section-broker-connections" className="dashboard-section space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Accounts / Broker Connections</h2>
          <p className="text-muted-foreground font-mono text-xs uppercase tracking-wider">
            Read-only demo connections feed portfolio totals when connected
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isFetching}
          className="font-mono text-xs uppercase tracking-wider"
        >
          <RefreshCw className={`h-3 w-3 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {message && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {BROKERS.map((broker) => {
          const connection = connections.find((item) => item.provider === broker.provider);
          const status = connection?.status ?? "disconnected";
          const isBusy = connect.isPending || disconnect.isPending || isFetching;

          return (
            <Card key={broker.provider} className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-sm font-mono uppercase tracking-wider">{broker.name}</CardTitle>
                  <Badge variant="outline" className={`font-mono text-[10px] uppercase ${statusClass(status)}`}>
                    {status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2 font-mono">
                      <span className="text-muted-foreground">Balance</span>
                      <span>{formatCurrency(connection?.balance ?? 0)}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-mono">
                      <span className="text-muted-foreground">Buying Power</span>
                      <span>{formatCurrency(connection?.buying_power ?? 0)}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-mono text-xs">
                      <span className="text-muted-foreground">Holdings</span>
                      <span>{connection?.holdings.length ?? 0}</span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleConnect(broker.provider)}
                    disabled={isBusy || status === "connected"}
                    className="font-mono text-xs uppercase"
                  >
                    Connect
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => connectDemo(broker.provider)}
                    disabled={isBusy || status === "connected"}
                    className="font-mono text-xs uppercase"
                  >
                    Demo Connect
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRefresh}
                    disabled={isBusy}
                    className="font-mono text-xs uppercase"
                  >
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => connection && handleDisconnect(connection.id)}
                    disabled={isBusy || !connection}
                    className="font-mono text-xs uppercase"
                  >
                    Disconnect
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
