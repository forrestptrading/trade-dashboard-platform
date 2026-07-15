import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/portfolio", (_req, res) => {
  res.status(410).json({
    success: false,
    error: "The legacy portfolio endpoint is retired. Use /api/snaptrade/portfolio.",
  });
});

export default router;
