import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, notificationsTable, type Notification } from "@workspace/db";
import { optionalAuth, requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const NOTIFICATION_TYPES = [
  "price_alert",
  "option_alert",
  "ai_alert",
  "earnings_alert",
] as const;

function toApi(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    symbol: n.symbol ?? null,
    title: n.title,
    message: n.message,
    severity: n.severity,
    status: n.status,
    metadata: n.metadata,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
}

// Demo notifications returned to unauthenticated callers.
const MOCK_NOTIFICATIONS = [
  {
    id: "ntf-001",
    type: "price_alert",
    symbol: "NVDA",
    title: "NVDA crossed $525",
    message: "NVDA is approaching your price target.",
    severity: "high",
    status: "unread",
    metadata: { target: 525 },
    created_at: "2026-06-25T14:10:00.000Z",
    updated_at: "2026-06-25T14:10:00.000Z",
  },
  {
    id: "ntf-002",
    type: "earnings_alert",
    symbol: "AAPL",
    title: "AAPL earnings in 4 days",
    message: "Apple reports Q3 earnings on June 30.",
    severity: "medium",
    status: "unread",
    metadata: { reportDate: "2026-06-30" },
    created_at: "2026-06-24T08:00:00.000Z",
    updated_at: "2026-06-24T08:00:00.000Z",
  },
];

const createSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  symbol: z.string().trim().max(12).optional(),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().max(2000).optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    message: z.string().trim().max(2000).optional(),
    severity: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["unread", "read", "dismissed"]).optional(),
    symbol: z.string().trim().max(12).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });

/**
 * GET /api/notifications
 * Authenticated: the caller's persisted notifications. Anonymous: demo/mock.
 */
router.get("/notifications", optionalAuth, async (req, res) => {
  if (!req.user) {
    const unread = MOCK_NOTIFICATIONS.filter((n) => n.status === "unread").length;
    res.json({
      success: true,
      source: "mock",
      count: MOCK_NOTIFICATIONS.length,
      unread,
      data: MOCK_NOTIFICATIONS,
    });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, req.user.id))
      .orderBy(desc(notificationsTable.createdAt));
    const unread = rows.filter((n) => n.status === "unread").length;
    res.json({
      success: true,
      source: "db",
      count: rows.length,
      unread,
      data: rows.map(toApi),
    });
  } catch (err) {
    logger.error(
      `[notifications] list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to load notifications" });
  }
});

/** GET /api/notifications/:id */
router.get("/notifications/:id", requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.id, String(req.params.id)),
          eq(notificationsTable.userId, req.user!.id),
        ),
      );
    if (!row) {
      res.status(404).json({ success: false, error: "Notification not found" });
      return;
    }
    res.json({ success: true, data: toApi(row) });
  } catch (err) {
    logger.error(
      `[notifications] get failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to load notification" });
  }
});

/** POST /api/notifications */
router.post("/notifications", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Invalid notification payload",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  try {
    const { type, title } = parsed.data;
    const [row] = await db
      .insert(notificationsTable)
      .values({
        userId: req.user!.id,
        type,
        title,
        symbol: parsed.data.symbol,
        message: parsed.data.message ?? "",
        severity: parsed.data.severity ?? "medium",
        metadata: parsed.data.metadata ?? {},
      })
      .returning();
    res.status(201).json({ success: true, data: toApi(row!) });
  } catch (err) {
    logger.error(
      `[notifications] create failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to create notification" });
  }
});

/** PATCH /api/notifications/:id */
router.patch("/notifications/:id", requireAuth, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Invalid update payload",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  try {
    const [updated] = await db
      .update(notificationsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, String(req.params.id)),
          eq(notificationsTable.userId, req.user!.id),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ success: false, error: "Notification not found" });
      return;
    }
    res.json({ success: true, data: toApi(updated) });
  } catch (err) {
    logger.error(
      `[notifications] update failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to update notification" });
  }
});

/** DELETE /api/notifications/:id */
router.delete("/notifications/:id", requireAuth, async (req, res) => {
  try {
    const [deleted] = await db
      .delete(notificationsTable)
      .where(
        and(
          eq(notificationsTable.id, String(req.params.id)),
          eq(notificationsTable.userId, req.user!.id),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ success: false, error: "Notification not found" });
      return;
    }
    res.json({ success: true, data: { id: deleted.id, deleted: true } });
  } catch (err) {
    logger.error(
      `[notifications] delete failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to delete notification" });
  }
});

export default router;
