import express, {
  type CookieOptions,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { SESSION_COOKIE_NAME } from "./lib/auth/session";

const app: Express = express();
const DEFAULT_DASHBOARD_ORIGIN = "https://forrestptrading.github.io";
const DEFAULT_API_ORIGIN =
  "https://trade-dashboard-api--forrestpbusines.replit.app";

function allowedOrigins(): Set<string> {
  const origins = new Set([DEFAULT_DASHBOARD_ORIGIN, DEFAULT_API_ORIGIN]);
  const configuredUrl = process.env["DASHBOARD_PUBLIC_URL"]?.trim();
  if (configuredUrl) {
    try {
      origins.add(new URL(configuredUrl).origin);
    } catch {
      logger.warn("[cors] DASHBOARD_PUBLIC_URL is not a valid URL");
    }
  }
  return origins;
}

const productionOrigins = allowedOrigins();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(
  cors({
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Session-Token"],
    origin(origin, callback) {
      const production = process.env["NODE_ENV"] === "production";
      if (!origin || !production || productionOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"));
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const originalCookie = res.cookie.bind(res);
  res.cookie = ((name: string, value: string, options?: CookieOptions) => {
    if (name === SESSION_COOKIE_NAME && value) {
      res.setHeader("X-Session-Token", value);
    }
    return options
      ? originalCookie(name, value, options)
      : originalCookie(name, value);
  }) as typeof res.cookie;
  next();
});

function requireDashboardOwnerEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ownerEmail =
    process.env["DASHBOARD_OWNER_EMAIL"]?.trim().toLowerCase() ?? "";
  const submittedEmail =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

  if (!ownerEmail) {
    res.status(503).json({
      success: false,
      error: "DASHBOARD_OWNER_EMAIL is not configured",
    });
    return;
  }
  if (submittedEmail !== ownerEmail) {
    res.status(403).json({
      success: false,
      error: "Dashboard access is restricted to the owner email",
    });
    return;
  }
  next();
}

app.use(
  ["/api/auth/register", "/api/auth/login"],
  requireDashboardOwnerEmail,
);

app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "trade-dashboard-api",
    data_policy: "connected-sources-only",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", router);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

export default app;
