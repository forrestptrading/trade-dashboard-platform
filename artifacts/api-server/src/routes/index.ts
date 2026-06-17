import { Router, type IRouter } from "express";
import healthRouter from "./health";
import portfolioRouter from "./portfolio";
import positionsRouter from "./positions";
import watchlistRouter from "./watchlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(portfolioRouter);
router.use(positionsRouter);
router.use(watchlistRouter);

export default router;
