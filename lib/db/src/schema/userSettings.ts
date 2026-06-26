import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-user application settings (one row per user). Stored as a flexible JSON
 * blob so the shape can evolve without migrations as the dashboard grows.
 */
export const userSettingsTable = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertUserSettings = typeof userSettingsTable.$inferInsert;
