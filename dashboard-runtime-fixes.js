/* Runtime safeguards for deployment routing, private-data display, timestamps, and Alpaca diagnostics. */
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

  function installAlpacaFooterRows() {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer) return false;

    if (!document.getElementById("alpacaDataStatus")) {
      const dataRow = document.createElement("p");
      dataRow.append(document.createTextNode("Alpaca Data: "));
      const dataStatus = document.createElement("strong");
      dataStatus.id = "alpacaDataStatus";
      dataStatus.textContent = "Checking...";
      dataStatus.setAttribute("aria-live", "polite");
      dataRow.appendChild(dataStatus);
      footer.appendChild(dataRow);
    }

    if (!document.getElementById("alpacaFeedStatus")) {
      const feedRow = document.createElement("p");
      feedRow.append(document.createTextNode("Alpaca Feed: "));
      const feedStatus = document.createElement("strong");
      feedStatus.id = "alpacaFeedStatus";
      feedStatus.textContent = "Checking...";
      feedRow.appendChild(feedStatus);
      footer.appendChild(feedRow);
    }

    return true;
  }

  function paintAlpacaStatus(id, text, tone = "neutral", title = "") {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    element.classList.remove("positive", "negative");
    if (tone === "positive") element.classList.add("positive");
    if (tone === "negative") element.classList.add("negative");
    if (title) element.title = title;
    else element.removeAttribute("title");
  }

  function compactEasternTime(value) {
    if (!value) return "time unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "time unavailable";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }

  let alpacaCheckPromise = null;
  let alpacaCheckTimer = null;

  async function checkAlpacaSidebarStatus() {
    if (alpacaCheckPromise) return alpacaCheckPromise;
    installAlpacaFooterRows();

    alpacaCheckPromise = (async () => {
      paintAlpacaStatus("alpacaDataStatus", "Checking...");
      paintAlpacaStatus("alpacaFeedStatus", "Checking...");

      try {
        const config = await apiFetchJson("/api/alpaca/config-check");
        const feed = String(config.feed || "iex").toUpperCase();
        const configured = Boolean(config.keyIdConfigured && config.secretKeyConfigured);

        if (!configured) {
          paintAlpacaStatus("alpacaDataStatus", "Missing Keys", "negative");
          paintAlpacaStatus("alpacaFeedStatus", feed);
          return;
        }

        if (!currentUser) {
          paintAlpacaStatus("alpacaDataStatus", "Configured", "positive");
          paintAlpacaStatus("alpacaFeedStatus", `${feed} · sign in to verify`);
          return;
        }

        const result = await apiFetchJson("/api/alpaca/test?symbol=AAPL");
        const bar = result?.data || {};
        const verifiedFeed = String(bar.feed || feed).toUpperCase();
        const fallback = bar.fallbackUsed ? " fallback" : "";
        paintAlpacaStatus("alpacaDataStatus", "Verified", "positive");
        paintAlpacaStatus(
          "alpacaFeedStatus",
          `${verifiedFeed}${fallback} · ${compactEasternTime(bar.timestamp)}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Alpaca check failed";
        paintAlpacaStatus("alpacaDataStatus", "Unavailable", "negative", message);
        paintAlpacaStatus("alpacaFeedStatus", "Check failed", "negative", message);
      }
    })().finally(() => {
      alpacaCheckPromise = null;
    });

    return alpacaCheckPromise;
  }

  function scheduleAlpacaSidebarCheck(delay = 0) {
    window.clearTimeout(alpacaCheckTimer);
    alpacaCheckTimer = window.setTimeout(() => {
      checkAlpacaSidebarStatus().catch((error) => {
        console.warn("Alpaca sidebar check failed:", error);
      });
    }, delay);
  }

  let refreshButtonBusy = false;

  async function runVisibleRefresh(button) {
    if (refreshButtonBusy) return;
    refreshButtonBusy = true;
    const originalText = button.textContent || "Refresh Data";
    button.disabled = true;
    button.textContent = "Refreshing...";
    button.setAttribute("aria-busy", "true");
    button.title = "Refreshing API health, quotes, private portfolio data, and Alpaca status";

    try {
      await refreshAllData();
      button.textContent = "Refreshed";
      button.title = `Last refreshed ${easternTimestamp(new Date().toISOString())}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed";
      button.textContent = "Refresh Failed";
      button.title = message;
      console.warn("Dashboard refresh failed:", error);
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
        button.removeAttribute("aria-busy");
        refreshButtonBusy = false;
      }, 1200);
    }
  }

  if (!globalThis.__forrestAlpacaSidebarStatusReady) {
    globalThis.__forrestAlpacaSidebarStatusReady = true;
    installAlpacaFooterRows();

    if (typeof renderAuth === "function") {
      const baseRenderAuth = renderAuth;
      renderAuth = function renderAuthWithAlpacaStatus() {
        baseRenderAuth();
        scheduleAlpacaSidebarCheck(50);
      };
    }

    if (typeof refreshAllData === "function") {
      const baseRefreshAllData = refreshAllData;
      refreshAllData = async function refreshAllDataWithAlpacaStatus() {
        await baseRefreshAllData();
        await checkAlpacaSidebarStatus();
      };
    }

    if (typeof setupFormsAndButtons === "function") {
      const baseSetupFormsAndButtons = setupFormsAndButtons;
      setupFormsAndButtons = function setupFormsAndButtonsWithWorkingRefresh() {
        baseSetupFormsAndButtons();
        const existingButton = document.getElementById("refreshDataBtn");
        if (!existingButton || existingButton.dataset.workingRefresh === "true") return;

        const replacementButton = existingButton.cloneNode(true);
        replacementButton.dataset.workingRefresh = "true";
        existingButton.replaceWith(replacementButton);
        replacementButton.addEventListener("click", () => runVisibleRefresh(replacementButton));
      };
    }

    scheduleAlpacaSidebarCheck();
    window.setInterval(checkAlpacaSidebarStatus, 5 * 60_000);
  }

  window.setTimeout(() => {
    if (typeof fetchQuotes === "function") fetchQuotes();
  }, 0);
})();
