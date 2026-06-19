import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/approvals/pending", (_req, res) => {
  const approvals = [
    {
      id: "appr-001",
      type: "buy",
      symbol: "MSFT",
      name: "Microsoft Corporation",
      quantity: 5,
      estimated_price: 379.0,
      estimated_total: 1895.0,
      submitted_at: "2026-06-17T09:15:00.000Z",
      expires_at: "2026-06-17T16:00:00.000Z",
      status: "pending_approval",
      reason: "Order exceeds single-trade threshold ($1,500)",
      requested_by: "algo-momentum-v2",
    },
    {
      id: "appr-002",
      type: "sell",
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      quantity: 2,
      estimated_price: 880.0,
      estimated_total: 1760.0,
      submitted_at: "2026-06-17T10:42:00.000Z",
      expires_at: "2026-06-17T16:00:00.000Z",
      status: "pending_approval",
      reason: "Sell represents > 25% of position",
      requested_by: "algo-rebalance-v1",
    },
    {
      id: "appr-003",
      type: "buy",
      symbol: "COIN",
      name: "Coinbase Global, Inc.",
      quantity: 10,
      estimated_price: 218.0,
      estimated_total: 2180.0,
      submitted_at: "2026-06-17T11:05:00.000Z",
      expires_at: "2026-06-17T16:00:00.000Z",
      status: "pending_approval",
      reason: "New position — not in approved watchlist",
      requested_by: "manual",
    },
  ];

  res.json({
    success: true,
    count: approvals.length,
    data: approvals,
  });
});

export default router;
