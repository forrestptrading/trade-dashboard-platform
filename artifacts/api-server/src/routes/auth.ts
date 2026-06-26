import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";
import {
  createSession,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from "../lib/auth/session.js";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

/** Shape returned to the client — never includes the password hash. */
function toPublicUser(user: Pick<User, "id" | "email" | "createdAt" | "lastLogin">) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.createdAt,
    last_login: user.lastLogin,
  };
}

function readSessionCookie(req: { cookies?: Record<string, string> }): string {
  return req.cookies?.[SESSION_COOKIE_NAME] ?? "";
}

/** Postgres unique-violation error code. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * POST /auth/register
 * Body: { email, password }
 * Creates a user, starts a session, sets the session cookie.
 */
router.post("/auth/register", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Invalid email or password",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      res
        .status(409)
        .json({ success: false, error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();

    const [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash, lastLogin: now })
      .returning();

    if (!user) {
      throw new Error("User insert returned no row");
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    logger.info(`[auth] registered user ${user.id}`);
    res.status(201).json({ success: true, data: { user: toPublicUser(user) } });
  } catch (err) {
    // Handle the race where two concurrent registrations pass the existence
    // check and one hits the unique constraint — return 409, not 500.
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ success: false, error: "An account with this email already exists" });
      return;
    }
    logger.error(
      `[auth] register failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Registration failed" });
  }
});

/**
 * POST /auth/login
 * Body: { email, password }
 * Verifies credentials, starts a session, sets the session cookie.
 */
router.post("/auth/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid email or password" });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    // Always run a verification to keep timing roughly constant whether or not
    // the user exists. Use a throwaway hash when no user is found.
    const hashToCheck =
      user?.passwordHash ??
      "scrypt$0000000000000000000000000000000000000000000000000000000000000000$00";
    const ok = await verifyPassword(password, hashToCheck);

    if (!user || !ok) {
      res.status(401).json({ success: false, error: "Invalid email or password" });
      return;
    }

    const now = new Date();
    await db
      .update(usersTable)
      .set({ lastLogin: now })
      .where(eq(usersTable.id, user.id));

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    logger.info(`[auth] login user ${user.id}`);
    res.json({
      success: true,
      data: { user: toPublicUser({ ...user, lastLogin: now }) },
    });
  } catch (err) {
    logger.error(
      `[auth] login failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Login failed" });
  }
});

/**
 * POST /auth/logout
 * Revokes the current session (if any) and clears the cookie. Idempotent.
 */
router.post("/auth/logout", async (req, res) => {
  try {
    const token = readSessionCookie(req);
    if (token) await revokeSession(token);
  } catch (err) {
    logger.warn(
      `[auth] logout revoke failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

/**
 * GET /auth/me
 * Returns the authenticated user. Requires a valid session.
 */
router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id))
      .limit(1);

    if (!user) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    res.json({ success: true, data: { user: toPublicUser(user) } });
  } catch (err) {
    logger.error(
      `[auth] me failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to load user" });
  }
});

export default router;
