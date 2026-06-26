import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Persistent AI trade queue. Each row is a trade idea generated for a user that
 * moves through an approval lifecycle. No real trades are ever placed — this is
 * a queue/record only (trading is out of scope).
 *
 * status: "Pending" | "Approved" | "Rejected" | "Executed"
 * risk:   "low" | "medium" | "high"
 * confidence: 0–100
 */
export const aiTradesTable = pgTable(
  "ai_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    strategy: text("strategy").notNull(),
    confidence: integer("confidence").notNull().default(0),
    risk: text("risk").notNull().default("medium"),
    status: text("status").notNull().default("Pending"),
    rationale: text("rationale"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_trades_user_id_idx").on(table.userId),
    index("ai_trades_status_idx").on(table.status),
  ],
);

export type AiTrade = typeof aiTradesTable.$inferSelect;
export type InsertAiTrade = typeof aiTradesTable.$inferInsert;
