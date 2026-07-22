import { Router, type IRouter } from "express";
import assistantRouter from "./assistant";
import authRouter from "./auth";
import healthRouter from "./health";
import quotesRouter from "./quotes";
import marketProjectionRouter from "./marketProjection";
import portfolioRouter from "./portfolio";
import snapTradeSessionRouter from "./snaptradeSession";
import snapTradeRouter from "./snaptrade";

const router: IRouter = Router();

// Production exposes only routes backed by real services or user-entered data.
// Historical experimental routes remain in the repository but are not mounted.
router.use(authRouter);
router.use(healthRouter);
router.use(quotesRouter);
router.use(marketProjectionRouter);
router.use(portfolioRouter);
router.use(snapTradeSessionRouter);
router.use(snapTradeRouter);
router.use(assistantRouter);

export default router;
