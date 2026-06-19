import { Router, type IRouter } from "express";

const router: IRouter = Router();

type ApprovalStatus = "pending_approval" | "approved" | "rejected";

interface Approval {
  id: string;
  type: string;
  symbol: string;
  name: string;
  quantity: number;
  estimated_price: number;
  estimated_total: number;
  submitted_at: string;
  expires_at: string;
  status: ApprovalStatus;
  reason: string;
  requested_by: string;
  resolved_at?: string;
  resolved_note?: string;
}

// In-memory store — shared across GET and POST handlers in this process
const approvals: Approval[] = [
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

// GET /api/approvals/pending — returns only pending items
router.get("/approvals/pending", (_req, res) => {
  const pending = approvals.filter((a) => a.status === "pending_approval");
  res.json({ success: true, count: pending.length, data: pending });
});

// POST /api/approvals/:id/approve
router.post("/approvals/:id/approve", (req, res) => {
  const { id } = req.params;
  const body = (req.body ?? {}) as { note?: string };

  const approval = approvals.find((a) => a.id === id);

  if (!approval) {
    res.status(404).json({ success: false, error: `Approval ${id} not found` });
    return;
  }

  if (approval.status !== "pending_approval") {
    res.status(409).json({
      success: false,
      error: `Approval ${id} is already ${approval.status}`,
      data: approval,
    });
    return;
  }

  approval.status = "approved";
  approval.resolved_at = new Date().toISOString();
  approval.resolved_note = body.note ?? null;

  res.json({
    success: true,
    message: `Approval ${id} approved. No real trade has been placed — mock only.`,
    data: approval,
  });
});

// POST /api/approvals/:id/reject
router.post("/approvals/:id/reject", (req, res) => {
  const { id } = req.params;
  const body = (req.body ?? {}) as { note?: string };

  const approval = approvals.find((a) => a.id === id);

  if (!approval) {
    res.status(404).json({ success: false, error: `Approval ${id} not found` });
    return;
  }

  if (approval.status !== "pending_approval") {
    res.status(409).json({
      success: false,
      error: `Approval ${id} is already ${approval.status}`,
      data: approval,
    });
    return;
  }

  approval.status = "rejected";
  approval.resolved_at = new Date().toISOString();
  approval.resolved_note = body.note ?? null;

  res.json({
    success: true,
    message: `Approval ${id} rejected. No real trade has been placed — mock only.`,
    data: approval,
  });
});

export default router;
