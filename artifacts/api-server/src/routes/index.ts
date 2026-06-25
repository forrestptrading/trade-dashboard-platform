import { Router, type IRouter } from "express";
import healthRouter from "./health";
import portfolioRouter from "./portfolio";
import positionsRouter from "./positions";
import watchlistRouter from "./watchlist";
import quotesRouter from "./quotes";
import quotesRefreshRouter from "./quotesRefresh";
import marketSummaryRouter from "./marketSummary";
import accountActivityRouter from "./accountActivity";
import portfolioSummaryRouter from "./portfolioSummary";
import optionsPositionsRouter from "./optionsPositions";
import activityRouter from "./activity";
import approvalsPendingRouter from "./approvalsPending";
import alertsRouter from "./alerts";
import aiOptionsAlertsRouter from "./aiOptionsAlerts";
import aiCommandCenterRouter from "./aiCommandCenter";

const router: IRouter = Router();

router.use(healthRouter);
router.use(portfolioRouter);
router.use(positionsRouter);
router.use(watchlistRouter);
router.use(quotesRouter);
router.use(quotesRefreshRouter);
router.use(marketSummaryRouter);
router.use(accountActivityRouter);
router.use(portfolioSummaryRouter);
router.use(optionsPositionsRouter);
router.use(activityRouter);
router.use(approvalsPendingRouter);
router.use(alertsRouter);
router.use(aiOptionsAlertsRouter);
router.use(aiCommandCenterRouter);

export default router;
