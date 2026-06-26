import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, aiTradesTable, type AiTrade } from "@workspace/db";
import { optionalAuth, requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

type TradeStatus = "Pending" | "Approved" | "Rejected" | "Executed";

function toApi(t: AiTrade) {
  return {
    id: t.id,
    ticker: t.ticker,
    strategy: t.strategy,
    confidence: t.confidence,
    risk: t.risk,
    status: t.status,
    rationale: t.rationale ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

// Demo queue returned to unauthenticated callers so the frontend keeps working.
const MOCK_TRADES = [
  {
    id: "ai-trade-001",
    ticker: "NVDA",
    strategy: "Momentum breakout",
    confidence: 82,
    risk: "high",
    status: "Pending" as TradeStatus,
    rationale: "Price reclaimed the 20-day MA on rising volume.",
    created_at: "2026-06-25T13:30:00.000Z",
    updated_at: "2026-06-25T13:30:00.000Z",
  },
  {
    id: "ai-trade-002",
    ticker: "AAPL",
    strategy: "Mean reversion",
    confidence: 67,
    risk: "medium",
    status: "Approved" as TradeStatus,
    rationale: "RSI oversold near support; favorable risk/reward.",
    created_at: "2026-06-24T18:05:00.000Z",
    updated_at: "2026-06-25T09:12:00.000Z",
  },
  {
    id: "ai-trade-003",
    ticker: "KO",
    strategy: "Covered call income",
    confidence: 74,
    risk: "low",
    status: "Pending" as TradeStatus,
    rationale: "Low volatility holding suitable for premium capture.",
    created_at: "2026-06-24T15:40:00.000Z",
    updated_at: "2026-06-24T15:40:00.000Z",
  },
];

const createSchema = z.object({
  ticker: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  strategy: z.string().trim().min(1).max(120),
  confidence: z.number().int().min(0).max(100),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string().trim().max(2000).optional(),
});

/**
 * GET /api/ai/trades
 * Authenticated: the caller's persisted queue. Anonymous: demo/mock queue.
 */
router.get("/ai/trades", optionalAuth, async (req, res) => {
  if (!req.user) {
    res.json({ success: true, source: "mock", count: MOCK_TRADES.length, data: MOCK_TRADES });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(aiTradesTable)
      .where(eq(aiTradesTable.userId, req.user.id))
      .orderBy(desc(aiTradesTable.createdAt));
    res.json({ success: true, source: "db", count: rows.length, data: rows.map(toApi) });
  } catch (err) {
    logger.error(
      `[ai-trades] list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to load trades" });
  }
});

/**
 * POST /api/ai/trades
 * Enqueue a new AI trade idea for the authenticated user (status: Pending).
 */
router.post("/ai/trades", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Invalid trade payload",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  try {
    const [row] = await db
      .insert(aiTradesTable)
      .values({ ...parsed.data, userId: req.user!.id, status: "Pending" })
      .returning();
    res.status(201).json({ success: true, data: toApi(row!) });
  } catch (err) {
    logger.error(
      `[ai-trades] create failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to create trade" });
  }
});

/** Apply a status transition to one of the caller's trades. */
async function transition(
  userId: string,
  id: string,
  from: TradeStatus,
  to: TradeStatus,
  res: import("express").Response,
): Promise<void> {
  try {
    // Atomic transition: only update when the row is in the expected state, so
    // concurrent approve/reject/execute calls can't both succeed.
    const [updated] = await db
      .update(aiTradesTable)
      .set({ status: to, updatedAt: new Date() })
      .where(
        and(
          eq(aiTradesTable.id, id),
          eq(aiTradesTable.userId, userId),
          eq(aiTradesTable.status, from),
        ),
      )
      .returning();

    if (updated) {
      res.json({ success: true, data: toApi(updated) });
      return;
    }

    // No row changed — distinguish "not found" from "wrong state".
    const [existing] = await db
      .select()
      .from(aiTradesTable)
      .where(and(eq(aiTradesTable.id, id), eq(aiTradesTable.userId, userId)));

    if (!existing) {
      res.status(404).json({ success: false, error: `Trade ${id} not found` });
      return;
    }
    res.status(409).json({
      success: false,
      error: `Trade ${id} is ${existing.status}; expected ${from} to ${to.toLowerCase()}`,
      data: toApi(existing),
    });
  } catch (err) {
    logger.error(
      `[ai-trades] transition failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to update trade" });
  }
}

// POST /api/ai/trades/:id/approve  (Pending -> Approved)
router.post("/ai/trades/:id/approve", requireAuth, (req, res) =>
  transition(req.user!.id, String(req.params.id), "Pending", "Approved", res),
);

// POST /api/ai/trades/:id/reject  (Pending -> Rejected)
router.post("/ai/trades/:id/reject", requireAuth, (req, res) =>
  transition(req.user!.id, String(req.params.id), "Pending", "Rejected", res),
);

// POST /api/ai/trades/:id/execute  (Approved -> Executed) — record only, no real trade
router.post("/ai/trades/:id/execute", requireAuth, (req, res) =>
  transition(req.user!.id, String(req.params.id), "Approved", "Executed", res),
);

export default router;
