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
  // Extended fields for programmatic submissions
  action?: string;
  asset_type?: string;
  strike?: number;
  expiration?: string;
  note?: string;
  source?: string;
}

let idCounter = 1000;
function nextId(): string {
  idCounter += 1;
  return `appr-${idCounter}`;
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

// POST /api/approvals — create a new pending approval (mock only, no real trade)
router.post("/approvals", (req, res) => {
  const body = (req.body ?? {}) as {
    symbol?: string;
    action?: string;
    assetType?: string;
    quantity?: number;
    strike?: number;
    expiration?: string;
    estimatedCost?: number;
    note?: string;
    source?: string;
  };

  if (!body.symbol || !body.action || body.quantity == null || body.estimatedCost == null) {
    res.status(400).json({
      success: false,
      error: "Required fields: symbol, action, quantity, estimatedCost",
    });
    return;
  }

  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000); // +8 hours

  const approval: Approval = {
    id: nextId(),
    type: body.action.toLowerCase(),
    symbol: body.symbol.toUpperCase(),
    name: body.symbol.toUpperCase(),
    quantity: body.quantity,
    estimated_price: body.quantity > 0 ? body.estimatedCost / body.quantity : 0,
    estimated_total: body.estimatedCost,
    submitted_at: now.toISOString(),
    expires_at: expires.toISOString(),
    status: "pending_approval",
    reason: body.note ?? "Programmatic submission",
    requested_by: body.source ?? "api",
    action: body.action,
    asset_type: body.assetType ?? "stock",
    strike: body.strike,
    expiration: body.expiration,
    note: body.note,
    source: body.source,
  };

  approvals.push(approval);

  res.status(201).json({
    success: true,
    message: "Approval request created. Mock only — no real trade placed.",
    data: approval,
  });
});

// GET /api/approvals/history — returns all approvals regardless of status
router.get("/approvals/history", (_req, res) => {
  const counts = {
    pending: approvals.filter((a) => a.status === "pending_approval").length,
    approved: approvals.filter((a) => a.status === "approved").length,
    rejected: approvals.filter((a) => a.status === "rejected").length,
  };

  const sorted = [...approvals].sort(
    (a, b) =>
      new Date(b.resolved_at ?? b.submitted_at).getTime() -
      new Date(a.resolved_at ?? a.submitted_at).getTime(),
  );

  res.json({ success: true, count: approvals.length, counts, data: sorted });
});

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
  approval.resolved_note = body.note ?? undefined;

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
  approval.resolved_note = body.note ?? undefined;

  res.json({
    success: true,
    message: `Approval ${id} rejected. No real trade has been placed — mock only.`,
    data: approval,
  });
});

export default router;
