import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Response } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";

export const SESSION_COOKIE_NAME = "sid";

/** Sessions live for 7 days from creation. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string;
}

function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

/** Only the hash of the token is persisted, never the raw token. */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Create a new session for a user. Returns the raw token (to be placed in the
 * cookie) and its expiry. The raw token is never stored server-side.
 */
export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessionsTable).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Resolve a raw session token to its user, or null if the token is invalid or
 * expired. Best-effort cleanup: expired matching rows are removed lazily.
 */
export async function getUserForToken(
  rawToken: string,
): Promise<AuthUser | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);

  const rows = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, tokenHash),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Revoke (delete) a single session by its raw token. Idempotent. */
export async function revokeSession(rawToken: string): Promise<void> {
  if (!rawToken) return;
  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.tokenHash, hashToken(rawToken)));
}

/** Best-effort removal of expired sessions. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
}

function cookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
}
