import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-user AI preferences (one row per user) — risk tolerance, alert verbosity,
 * preferred models, etc. Stored as a flexible JSON blob so it can evolve freely.
 */
export const aiPreferencesTable = pgTable("ai_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AiPreferences = typeof aiPreferencesTable.$inferSelect;
export type InsertAiPreferences = typeof aiPreferencesTable.$inferInsert;
