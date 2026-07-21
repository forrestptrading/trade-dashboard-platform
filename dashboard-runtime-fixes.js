/* Runtime safeguards for deployment routing, private-data display, and timestamps. */
(() => {
  const host = window.location.hostname.toLowerCase();
  const isReplitFrontendPreview =
    document.querySelector(".app-shell") &&
    (host.endsWith(".replit.dev") ||
      host.endsWith(".repl.co") ||
      (host.endsWith(".replit.app") &&
        host !== "trade-dashboard-api--forrestpbusines.replit.app"));

  if (isReplitFrontendPreview) {
    window.location.replace(
      "https://forrestptrading.github.io/trade-dashboard-platform/?source=replit"
    );
    return;
  }

  function easternTimestamp(value, unavailable = "Unavailable") {
    if (!value) return unavailable;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return unavailable;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }

  if (typeof formatTimestamp === "function") {
    formatTimestamp = easternTimestamp;
  }

  if (typeof renderPortfolio === "function") {
    const baseRenderPortfolio = renderPortfolio;
    renderPortfolio = function renderPortfolioWithAccurateEmptyState() {
      baseRenderPortfolio();
      const accounts = typeof safeArray === "function"
        ? safeArray(portfolio?.accounts)
        : Array.isArray(portfolio?.accounts)
          ? portfolio.accounts
          : [];

      if (currentUser && accounts.length) return;

      ["portfolioValue", "buyingPower", "cash", "investedValue", "openPositions"].forEach(
        (id) => setText(id, "--")
      );
      setText("dailyPL", "--");
      setText("dailyPercent", "Not available until connected data loads");
      setText(
        "portfolioSource",
        currentUser ? "Connected account data unavailable" : "Sign in required"
      );
      setText(
        "portfolioConnectionStatus",
        currentUser ? "Data Unavailable" : "Sign In Required"
      );
      setText("portfolioLastSync", "Data as of: unavailable");
      setText("dataFreshnessStatus", "Unavailable");
      setText("dataRetrievedAt", "Retrieved: never");
    };

    renderPortfolio();
  }

  window.setTimeout(() => {
    if (typeof fetchQuotes === "function") fetchQuotes();
  }, 0);
})();
