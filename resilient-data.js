/* Preserve the last verified SnapTrade portfolio during temporary refresh failures. */
(() => {
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function requestVerifiedPortfolio() {
    const result = await apiFetchJson("/api/snaptrade/portfolio");
    if (result.source !== "snaptrade" || !result.data) {
      throw new Error("The API did not return a verified SnapTrade portfolio");
    }
    return {
      ...emptyPortfolio(),
      ...result.data,
      accounts: safeArray(result.data.accounts),
      holdings: safeArray(result.data.holdings),
      data_freshness: safeArray(result.data.data_freshness)
    };
  }

  checkAuth = async function resilientCheckAuth() {
    try {
      const result = await apiFetchJson("/api/auth/me");
      currentUser = result.data?.user || null;
    } catch (error) {
      currentUser = null;
      if (error?.status === 401 || error?.status === 403) {
        saveSessionToken("");
      }
    }
    renderAuth();
  };

  fetchPortfolio = async function resilientFetchPortfolio() {
    if (!currentUser) {
      portfolio = emptyPortfolio();
      renderAllPortfolioViews();
      return;
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        portfolio = await requestVerifiedPortfolio();
        setBrokerageMessage(
          portfolio.accounts.length
            ? "Connected brokerage data loaded."
            : "SnapTrade is connected, but no investment accounts were returned."
        );
        renderAllPortfolioViews();
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(900);
      }
    }

    const hasVerifiedData = safeArray(portfolio.accounts).length > 0;
    if (lastError?.status === 401 || lastError?.status === 403) {
      saveSessionToken("");
      currentUser = null;
      portfolio = emptyPortfolio();
      renderAuth();
      setBrokerageMessage("Your dashboard session expired. Sign in again to reload brokerage data.", true);
    } else if (hasVerifiedData) {
      setBrokerageMessage(
        `Refresh failed: ${lastError?.message || "temporary SnapTrade error"}. Showing the last verified portfolio.`,
        true
      );
    } else {
      portfolio = emptyPortfolio();
      setBrokerageMessage(
        `Portfolio unavailable: ${lastError?.message || "temporary SnapTrade error"}`,
        true
      );
    }
    renderAllPortfolioViews();
  };

  const baseRenderPortfolio = renderPortfolio;
  renderPortfolio = function renderPortfolioWithExplicitAccessState() {
    baseRenderPortfolio();
    if (currentUser) return;

    ["portfolioValue", "buyingPower", "cash", "investedValue", "dailyPL", "openPositions"].forEach((id) => {
      setText(id, "--");
    });
    setText("portfolioSource", "Owner sign-in required");
    setText("accountCount", "Sign in to load accounts");
    setText("portfolioConnectionStatus", "Sign In Required");
    setText("portfolioLastSync", "Data as of: hidden");
    setText("dataFreshnessStatus", "Sign In Required");
    setText("dataRetrievedAt", "Retrieved: hidden");
  };
})();
