import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-user notifications / alerts persisted by the Notification Service.
 *
 * type:     "price_alert" | "option_alert" | "ai_alert" | "earnings_alert"
 * severity: "low" | "medium" | "high"
 * status:   "unread" | "read" | "dismissed"
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    symbol: text("symbol"),
    title: text("title").notNull(),
    message: text("message").notNull().default(""),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("unread"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("notifications_user_id_idx").on(table.userId)],
);

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
