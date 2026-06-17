import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/portfolio", (_req, res) => {
  // TODO: Replace with Robinhood API call
  // GET https://api.robinhood.com/portfolios/
  // Requires: Authorization: Bearer <access_token>
  const portfolio = {
    account_number: "MOCK-12345678",
    total_value: 52341.87,
    cash: 3241.56,
    invested_value: 49100.31,
    day_change: 412.34,
    day_change_percent: 0.79,
    total_return: 7241.87,
    total_return_percent: 16.07,
    buying_power: 3241.56,
    currency: "USD",
    updated_at: new Date().toISOString(),
    _robinhood_note: "Future: map from portfolios/ + accounts/ endpoints",
  };

  res.json({ success: true, data: portfolio });
});

export default router;
