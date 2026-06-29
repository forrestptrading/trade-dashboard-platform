import { db, brokerConnectionsTable, type BrokerConnection } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { decryptCredentialPayload, encryptCredentialPayload } from "../lib/brokerCredentials.js";
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
  institutionName?: string | null;
  accounts?: PlaidSafeAccountMetadata[];
}

export interface PlaidSafeAccountMetadata {
  account_id: string;
  name: string | null;
  official_name: string | null;
  type: string | null;
  subtype: string | null;
  mask: string | null;
}

export interface SafePlaidConnectionMetadata {
  item_id: string | null;
  institution_name: string | null;
  accounts: PlaidSafeAccountMetadata[];
  created_at: Date;
  updated_at: Date;
}

function metadataValue(metadata: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(metadata, key) ? metadata[key] : null;
}

function toSafeAccounts(accounts: unknown): PlaidSafeAccountMetadata[] {
  if (!Array.isArray(accounts)) return [];

  return accounts
    .map((account): PlaidSafeAccountMetadata | null => {
      if (!account || typeof account !== "object") return null;
      const raw = account as Record<string, unknown>;
      const accountId = raw["account_id"];

      if (typeof accountId !== "string" || !accountId) return null;

      return {
        account_id: accountId,
        name: typeof raw["name"] === "string" ? raw["name"] : null,
        official_name: typeof raw["official_name"] === "string" ? raw["official_name"] : null,
        type: typeof raw["type"] === "string" ? raw["type"] : null,
        subtype: typeof raw["subtype"] === "string" ? raw["subtype"] : null,
        mask: typeof raw["mask"] === "string" ? raw["mask"] : null,
      };
    })
    .filter((account): account is PlaidSafeAccountMetadata => Boolean(account));
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

  const existing = await db
    .select()
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.userId, input.userId),
        eq(brokerConnectionsTable.brokerId, input.provider),
        eq(brokerConnectionsTable.label, input.label),
      ),
    )
    .limit(1);

  const metadata = {
    source: "plaid",
    plaidItemId: input.itemId,
    plaidEnvironment: process.env["PLAID_ENV"] || "sandbox",
    requestId: input.requestId ?? null,
    institutionName: input.institutionName ?? null,
    accounts: input.accounts ?? [],
    lastConnectedAt: storedAt,
  };

  if (existing[0]) {
    const rows = await db
      .update(brokerConnectionsTable)
      .set({
        status: "connected",
        encryptedCredentials,
        metadata,
        updatedAt: now,
      })
      .where(eq(brokerConnectionsTable.id, existing[0].id))
      .returning();

    const connection = rows[0];

    if (!connection) {
      throw new Error("Failed to update Plaid broker connection.");
    }

    return connection;
  }

  const rows = await db
    .insert(brokerConnectionsTable)
    .values({
      userId: input.userId,
      brokerId: input.provider,
      label: input.label,
      status: "connected",
      encryptedCredentials,
      metadata,
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

export async function getLatestPlaidCredentialForUser(
  userId: string,
): Promise<{ connection: BrokerConnection; credentials: PlaidCredentialRecord } | null> {
  const rows = await db
    .select()
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.userId, userId),
        eq(brokerConnectionsTable.status, "connected"),
        isNotNull(brokerConnectionsTable.encryptedCredentials),
      ),
    )
    .orderBy(desc(brokerConnectionsTable.updatedAt))
    .limit(1);

  const connection = rows[0];
  if (!connection?.encryptedCredentials) return null;

  return {
    connection,
    credentials: decryptCredentialPayload<PlaidCredentialRecord>(connection.encryptedCredentials),
  };
}

export async function listSafePlaidConnectionsForUser(
  userId: string,
): Promise<SafePlaidConnectionMetadata[]> {
  const rows = await db
    .select()
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.userId, userId),
        eq(brokerConnectionsTable.status, "connected"),
        isNotNull(brokerConnectionsTable.encryptedCredentials),
      ),
    )
    .orderBy(desc(brokerConnectionsTable.updatedAt));

  return rows.map((connection) => {
    const metadata = connection.metadata ?? {};

    return {
      item_id: typeof metadataValue(metadata, "plaidItemId") === "string"
        ? (metadataValue(metadata, "plaidItemId") as string)
        : null,
      institution_name: typeof metadataValue(metadata, "institutionName") === "string"
        ? (metadataValue(metadata, "institutionName") as string)
        : connection.label,
      accounts: toSafeAccounts(metadataValue(metadata, "accounts")),
      created_at: connection.createdAt,
      updated_at: connection.updatedAt,
    };
  });
}

export function normalizePlaidSafeAccounts(accounts: unknown): PlaidSafeAccountMetadata[] {
  return toSafeAccounts(accounts);
}
