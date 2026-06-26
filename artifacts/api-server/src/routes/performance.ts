import { Router, type IRouter } from "express";
import {
  getPerformanceReport,
  isPerformancePeriod,
} from "../services/performanceService.js";

const router: IRouter = Router();

/**
 * GET /api/performance
 * Performance Service. Returns daily / weekly / monthly / yearly performance.
 * Optional ?period=daily|weekly|monthly|yearly returns a single period.
 * Mock values until brokers expose complete history.
 */
router.get("/performance", (req, res) => {
  const report = getPerformanceReport();
  const period = req.query["period"];

  if (typeof period === "string") {
    if (!isPerformancePeriod(period)) {
      res.status(400).json({
        success: false,
        error: "period must be one of: daily, weekly, monthly, yearly",
      });
      return;
    }
    res.json({
      success: true,
      isPlaceholder: report.isPlaceholder,
      asOf: report.asOf,
      data: report.periods[period],
    });
    return;
  }

  res.json({
    success: true,
    isPlaceholder: report.isPlaceholder,
    asOf: report.asOf,
    data: report.periods,
  });
});

export default router;
