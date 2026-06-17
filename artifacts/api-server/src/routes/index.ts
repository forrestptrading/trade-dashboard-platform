import { Router, type IRouter } from "express";
import healthRouter from "./health";
import portfolioRouter from "./portfolio";
import positionsRouter from "./positions";
import watchlistRouter from "./watchlist";
import quotesRouter from "./quotes";
import quotesRefreshRouter from "./quotesRefresh";
import marketSummaryRouter from "./marketSummary";
import accountActivityRouter from "./accountActivity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(portfolioRouter);
router.use(positionsRouter);
router.use(watchlistRouter);
router.use(quotesRouter);
router.use(quotesRefreshRouter);
router.use(marketSummaryRouter);
router.use(accountActivityRouter);

export default router;
