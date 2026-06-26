import type { Request, Response, NextFunction } from "express";
import {
  SESSION_COOKIE_NAME,
  getUserForToken,
  type AuthUser,
} from "../lib/auth/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated when a valid session cookie is present. */
      user?: AuthUser;
    }
  }
}

function readToken(req: Request): string {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  return cookies?.[SESSION_COOKIE_NAME] ?? "";
}

/**
 * Attaches `req.user` when a valid session exists, but never blocks the request.
 * Use this on routes that should keep working for anonymous users (e.g. the
 * existing data routes that fall back to mock/demo data).
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = readToken(req);
    if (token) {
      const user = await getUserForToken(token);
      if (user) req.user = user;
    }
  } catch {
    // Never let an auth lookup failure break an otherwise-anonymous request.
  }
  next();
}

/**
 * Requires a valid session. Responds 401 and stops the chain when absent.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readToken(req);
  const user = token ? await getUserForToken(token) : null;

  if (!user) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  req.user = user;
  next();
}
