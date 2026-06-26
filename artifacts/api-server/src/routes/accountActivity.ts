import { Router, type IRouter } from "express";
import { useLiveData, getBroker } from "../broker/index.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

type ActivityType = "buy" | "sell" | "dividend" | "deposit" | "withdrawal";
type ActivityStatus = "completed" | "pending" | "cancelled";

interface ActivityItem {
  id: string;
  type: ActivityType;
  symbol?: string;
  name?: string;
  quantity?: number;
  price?: number;
  amount: number;
  status: ActivityStatus;
  date: string;
  description: string;
  source: string;
}

const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: "act-001",
    type: "buy",
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    quantity: 4,
    price: 832.14,
    amount: -3328.56,
    status: "completed",
    date: "2026-06-16T14:32:11.000Z",
    description: "Bought 4 shares of NVDA at $832.14",
    source: "mock",
  },
  {
    id: "act-002",
    type: "sell",
    symbol: "TSLA",
    name: "Tesla, Inc.",
    quantity: 5,
    price: 255.42,
    amount: 1277.1,
    status: "completed",
    date: "2026-06-15T11:08:45.000Z",
    description: "Sold 5 shares of TSLA at $255.42",
    source: "mock",
  },
  {
    id: "act-003",
    type: "dividend",
    symbol: "AAPL",
    name: "Apple Inc.",
    amount: 14.25,
    status: "completed",
    date: "2026-06-13T09:00:00.000Z",
    description: "Dividend payment from AAPL — $0.25/share × 57 shares",
    source: "mock",
  },
  {
    id: "act-004",
    type: "buy",
    symbol: "META",
    name: "Meta Platforms, Inc.",
    quantity: 3,
    price: 471.88,
    amount: -1415.64,
    status: "completed",
    date: "2026-06-12T13:21:09.000Z",
    description: "Bought 3 shares of META at $471.88",
    source: "mock",
  },
  {
    id: "act-005",
    type: "deposit",
    amount: 5000.0,
    status: "completed",
    date: "2026-06-10T08:00:00.000Z",
    description: "ACH deposit from Bank of America ****1234",
    source: "mock",
  },
  {
    id: "act-006",
    type: "buy",
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    quantity: 10,
    price: 178.33,
    amount: -1783.3,
    status: "completed",
    date: "2026-06-09T10:44:55.000Z",
    description: "Bought 10 shares of AMZN at $178.33",
    source: "mock",
  },
  {
    id: "act-007",
    type: "sell",
    symbol: "PLTR",
    name: "Palantir Technologies Inc.",
    quantity: 20,
    price: 26.14,
    amount: 522.8,
    status: "completed",
    date: "2026-06-06T15:58:22.000Z",
    description: "Sold 20 shares of PLTR at $26.14",
    source: "mock",
  },
  {
    id: "act-008",
    type: "dividend",
    symbol: "MSFT",
    name: "Microsoft Corporation",
    amount: 15.0,
    status: "completed",
    date: "2026-06-05T09:00:00.000Z",
    description: "Dividend payment from MSFT — $0.75/share × 20 shares",
    source: "mock",
  },
  {
    id: "act-009",
    type: "buy",
    symbol: "MSFT",
    name: "Microsoft Corporation",
    quantity: 5,
    price: 408.91,
    amount: -2044.55,
    status: "pending",
    date: "2026-06-17T09:15:00.000Z",
    description: "Buying 5 shares of MSFT at market price",
    source: "mock",
  },
  {
    id: "act-010",
    type: "withdrawal",
    amount: -1500.0,
    status: "pending",
    date: "2026-06-17T07:30:00.000Z",
    description: "ACH withdrawal to Bank of America ****1234",
    source: "mock",
  },
];

router.get("/account/activity", async (req, res) => {
  const typeFilter = req.query["type"] as string | undefined;
  const statusFilter = req.query["status"] as string | undefined;
  const limitParam = req.query["limit"];
  const limit = limitParam ? parseInt(String(limitParam), 10) : undefined;

  const validTypes: ActivityType[] = ["buy", "sell", "dividend", "deposit", "withdrawal"];
  const validStatuses: ActivityStatus[] = ["completed", "pending", "cancelled"];

  if (typeFilter && !validTypes.includes(typeFilter as ActivityType)) {
    res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
    return;
  }
  if (statusFilter && !validStatuses.includes(statusFilter as ActivityStatus)) {
    res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    return;
  }
  if (limit !== undefined && (isNaN(limit) || limit < 1)) {
    res.status(400).json({ success: false, error: "limit must be a positive integer" });
    return;
  }

  let baseActivity = MOCK_ACTIVITY;
  let dataSource: string = "mock";

  if (useLiveData()) {
    try {
      // Live: merge GET /orders/ (buys/sells) + GET /dividends/
      // Each order.instrument URL must be resolved to symbol + name.
      // Map order.state → ActivityStatus, order.side → ActivityType
      const broker = getBroker(req.query["broker"] as string | undefined);
      const [orders, dividends] = await Promise.all([
        broker.getOrders(),
        broker.getDividends(),
      ]);

      // Stub: transformation goes here when implemented.
      // For now the stub throws, so this block is unreachable.
      void orders;
      void dividends;
      dataSource = broker.brokerId;
    } catch (err) {
      logger.warn(`[broker] getOrders/getDividends failed, using mock: ${err instanceof Error ? err.message : err}`);
    }
  }

  let results = [...baseActivity].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  if (typeFilter) results = results.filter((a) => a.type === typeFilter);
  if (statusFilter) results = results.filter((a) => a.status === statusFilter);
  if (limit) results = results.slice(0, limit);

  const summary = {
    total_invested: baseActivity
      .filter((a) => a.type === "buy" && a.status === "completed")
      .reduce((sum, a) => sum + Math.abs(a.amount), 0)
      .toFixed(2),
    total_proceeds: baseActivity
      .filter((a) => a.type === "sell" && a.status === "completed")
      .reduce((sum, a) => sum + a.amount, 0)
      .toFixed(2),
    total_dividends: baseActivity
      .filter((a) => a.type === "dividend" && a.status === "completed")
      .reduce((sum, a) => sum + a.amount, 0)
      .toFixed(2),
    total_deposits: baseActivity
      .filter((a) => a.type === "deposit" && a.status === "completed")
      .reduce((sum, a) => sum + a.amount, 0)
      .toFixed(2),
    pending_count: baseActivity.filter((a) => a.status === "pending").length,
  };

  res.json({ success: true, source: dataSource, count: results.length, summary, data: results });
});

export default router;
