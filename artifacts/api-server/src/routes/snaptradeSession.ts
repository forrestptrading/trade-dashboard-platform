import { Router, type IRouter, type Request } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  clearSessionCookie,
  revokeSession,
  SESSION_COOKIE_NAME,
} from "../lib/auth/session";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function readSessionToken(req: Request): string {
  const authorization = req.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  return cookies?.[SESSION_COOKIE_NAME] ?? "";
}

router.post("/snaptrade/logout", requireAuth, async (req, res) => {
  try {
    const token = readSessionToken(req);
    if (token) await revokeSession(token);
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "[snaptrade] session revoke failed",
    );
  }

  clearSessionCookie(res);
  res.json({ success: true });
});

export default router;
