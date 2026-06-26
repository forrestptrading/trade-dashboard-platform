import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-user watchlists. Each user can keep multiple named watchlists, each with
 * many symbols. (Distinct from the existing public/mock watchlist endpoint.)
 */
export const watchlistsTable = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("watchlists_user_id_idx").on(table.userId)],
);

export const watchlistItemsTable = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlistsTable.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("watchlist_items_watchlist_id_idx").on(table.watchlistId)],
);

export type Watchlist = typeof watchlistsTable.$inferSelect;
export type InsertWatchlist = typeof watchlistsTable.$inferInsert;
export type WatchlistItem = typeof watchlistItemsTable.$inferSelect;
export type InsertWatchlistItem = typeof watchlistItemsTable.$inferInsert;
