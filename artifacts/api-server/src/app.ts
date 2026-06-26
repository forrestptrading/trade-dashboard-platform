import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Reflect the request origin and allow credentials so cookie-based sessions work
// whether the frontend is served same-origin (Vite dev proxy) or cross-origin.
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send("Trade Dashboard API is running");
});

app.get("/quotes", (_req, res) => {
  res.json({
    SPY: 0,
    QQQ: 0,
    TSLA: 0,
    NVDA: 0,
  });
});

app.use("/api", router);

export default app;
