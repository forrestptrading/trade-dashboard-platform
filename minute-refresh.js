/* Refresh connected SnapTrade portfolio data once per minute while the dashboard is visible. */
(() => {
  const PORTFOLIO_REFRESH_INTERVAL_MS = 60_000;
  let portfolioRefreshInFlight = false;

  async function refreshVisiblePortfolio() {
    if (
      document.visibilityState !== "visible" ||
      !currentUser ||
      portfolioRefreshInFlight
    ) {
      return;
    }

    portfolioRefreshInFlight = true;
    try {
      await fetchPortfolio();
    } catch (error) {
      console.warn("Minute portfolio refresh failed:", error);
    } finally {
      portfolioRefreshInFlight = false;
    }
  }

  window.setInterval(refreshVisiblePortfolio, PORTFOLIO_REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshVisiblePortfolio();
    }
  });
})();
