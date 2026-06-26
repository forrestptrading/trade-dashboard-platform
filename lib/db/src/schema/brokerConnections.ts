import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-user broker connections. A single user may connect multiple brokers
 * (e.g. Robinhood + Schwab) and even multiple accounts per broker via `label`.
 *
 * NOTE: trading and live credential storage are intentionally NOT implemented
 * in this sprint. `encryptedCredentials` is a placeholder for a future sprint
 * and must only ever hold encrypted material — never plaintext secrets.
 */
export const brokerConnectionsTable = pgTable(
  "broker_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    brokerId: text("broker_id").notNull(),
    label: text("label"),
    status: text("status").notNull().default("disconnected"),
    encryptedCredentials: text("encrypted_credentials"),
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
  (table) => [
    index("broker_connections_user_id_idx").on(table.userId),
    unique("broker_connections_user_broker_label_uq").on(
      table.userId,
      table.brokerId,
      table.label,
    ),
  ],
);

export type BrokerConnection = typeof brokerConnectionsTable.$inferSelect;
export type InsertBrokerConnection =
  typeof brokerConnectionsTable.$inferInsert;
