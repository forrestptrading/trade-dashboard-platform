import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Application users.
 *
 * `passwordHash` stores a scrypt-derived hash (see api-server auth/password.ts).
 * Plaintext passwords are NEVER stored.
 */
export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastLogin: timestamp("last_login", { withTimezone: true }),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
