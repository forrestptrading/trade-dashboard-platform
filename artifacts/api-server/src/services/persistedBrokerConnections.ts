import { db, brokerConnectionsTable, type BrokerConnection } from "@workspace/db";
import { encryptCredentialPayload } from "../lib/brokerCredentials.js";
import type { BrokerProvider } from "./brokerConnectionsStore.js";

export interface PlaidCredentialRecord extends Record<string, unknown> {
  accessToken: string;
  itemId: string;
  provider: BrokerProvider;
  plaidEnvironment: string;
  storedAt: string;
}

export interface PersistPlaidConnectionInput {
  userId: string;
  provider: BrokerProvider;
  label: string;
  accessToken: string;
  itemId: string;
  requestId?: string;
}

export async function persistPlaidBrokerConnection(
  input: PersistPlaidConnectionInput,
): Promise<BrokerConnection> {
  const now = new Date();
  const storedAt = now.toISOString();
  const encryptedCredentials = encryptCredentialPayload({
    accessToken: input.accessToken,
    itemId: input.itemId,
    provider: input.provider,
    plaidEnvironment: process.env["PLAID_ENV"] || "sandbox",
    storedAt,
  } satisfies PlaidCredentialRecord);

  const rows = await db
    .insert(brokerConnectionsTable)
    .values({
      userId: input.userId,
      brokerId: input.provider,
      label: input.label,
      status: "connected",
      encryptedCredentials,
      metadata: {
        source: "plaid",
        plaidItemId: input.itemId,
        plaidEnvironment: process.env["PLAID_ENV"] || "sandbox",
        requestId: input.requestId ?? null,
        lastConnectedAt: storedAt,
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const connection = rows[0];

  if (!connection) {
    throw new Error("Failed to persist Plaid broker connection.");
  }

  return connection;
}
