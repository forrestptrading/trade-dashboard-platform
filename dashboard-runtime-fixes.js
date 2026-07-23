/* Runtime safeguards for deployment routing, private-data display, timestamps, Alpaca diagnostics, and live watchlist mode. */
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

  const LIVE_RH_INTERVAL_MS = 1_000;
  const LIVE_ALPACA_INTERVAL_MS = 5_000;
  let liveWatchlistRunning = false;
  let robinhoodTimer = null;
  let alpacaTimer = null;
  let robinhoodBusy = false;
  let alpacaBusy = false;
  let robinhoodFailures = 0;
  let robinhoodLiveQuotes = {};
  let alpacaLiveQuotes = {};
  let robinhoodRequestFailed = false;

  function installLiveWatchlistStyles() {
    if (document.getElementById("liveWatchlistStyles")) return;
    const style = document.createElement("style");
    style.id = "liveWatchlistStyles";
    style.textContent = `
      .live-watchlist-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin:0 0 14px; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-card); background:var(--surface); }
      .live-watchlist-toolbar strong { font-size:13px; }
      .live-watchlist-toolbar span { color:var(--muted); font-size:12px; }
      .live-watchlist-row { display:grid; grid-template-columns:minmax(86px,.7fr) minmax(100px,.8fr) minmax(160px,1.25fr) minmax(145px,1fr) auto; gap:12px; align-items:center; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-card); padding:12px 14px; font-variant-numeric:tabular-nums; }
      .live-watchlist-symbol { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
      .live-watchlist-price { font-size:18px; font-weight:700; }
      .live-watchlist-detail { display:grid; gap:2px; color:var(--text-secondary); font-size:12px; }
      .live-watchlist-detail small { color:var(--muted); }
      .live-watchlist-badge { display:inline-block; border-radius:999px; padding:2px 7px; font-size:10px; font-weight:800; letter-spacing:.03em; background:rgba(79,206,123,.18); color:var(--green); border:1px solid rgba(79,206,123,.28); }
      .live-watchlist-badge.aged { background:rgba(227,184,103,.16); color:var(--amber); border-color:rgba(227,184,103,.28); }
      .live-watchlist-badge.unavailable { background:rgba(236,106,118,.16); color:var(--red); border-color:rgba(236,106,118,.28); }
      @media (max-width: 820px) { .live-watchlist-row { grid-template-columns:1fr 1fr; } .live-watchlist-row button { justify-self:start; } }
    `;
    document.head.appendChild(style);
  }

  function installLiveWatchlistToolbar() {
    const section = document.getElementById("watchlist");
    const table = document.getElementById("watchlistTable");
    if (!section || !table || document.getElementById("liveWatchlistToolbar")) return;
    const toolbar = document.createElement("div");
    toolbar.id = "liveWatchlistToolbar";
    toolbar.className = "live-watchlist-toolbar";
    const state = document.createElement("strong");
    state.id = "liveWatchlistModeStatus";
    state.textContent = "Live Mode Paused";
    const note = document.createElement("span");
    note.id = "liveWatchlistModeNote";
    note.textContent = "Opens automatically on this page.";
    toolbar.append(state, note);
    table.before(toolbar);
  }

  function watchlistIsVisible() {
    const section = document.getElementById("watchlist");
    return Boolean(section?.classList.contains("active-section") && !document.hidden);
  }

  function quoteAgeSeconds(timestamp) {
    if (!timestamp) return null;
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return null;
    return Math.max(0, (Date.now() - time) / 1000);
  }

  function ageLabel(age) {
    if (age === null) return "age unavailable";
    if (age < 1) return "<1s old";
    if (age < 60) return `${age.toFixed(age < 10 ? 1 : 0)}s old`;
    return `${Math.floor(age / 60)}m old`;
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function selectLiveQuote(symbol) {
    const robinhood = robinhoodLiveQuotes[symbol] || quotes?.[symbol] || null;
    const alpaca = alpacaLiveQuotes[symbol] || null;
    const rhPrice = finiteOrNull(robinhood?.price);
    const alpacaPrice = finiteOrNull(alpaca?.price);
    const rhTime = robinhood?.timestamp ? new Date(robinhood.timestamp).getTime() : NaN;
    const alpacaTime = alpaca?.timestamp ? new Date(alpaca.timestamp).getTime() : NaN;

    if (rhPrice === null && alpacaPrice !== null) return { quote: alpaca, provider: "Alpaca IEX" };
    if (rhPrice !== null && alpacaPrice !== null && robinhoodRequestFailed && Number.isFinite(alpacaTime) && (!Number.isFinite(rhTime) || alpacaTime >= rhTime)) {
      return { quote: alpaca, provider: "Alpaca IEX" };
    }
    if (rhPrice !== null && alpacaPrice !== null && Number.isFinite(rhTime) && Number.isFinite(alpacaTime) && alpacaTime - rhTime > 15_000) {
      return { quote: alpaca, provider: "Alpaca IEX" };
    }
    if (rhPrice !== null) return { quote: robinhood, provider: "Robinhood" };
    if (alpacaPrice !== null) return { quote: alpaca, provider: "Alpaca IEX" };
    return { quote: robinhood || alpaca, provider: "Unavailable" };
  }

  function crossCheckText(symbol) {
    const rh = finiteOrNull(robinhoodLiveQuotes[symbol]?.price);
    const alp = finiteOrNull(alpacaLiveQuotes[symbol]?.price);
    if (rh === null || alp === null || rh === 0) return currentUser ? "Awaiting cross-check" : "Sign in for Alpaca cross-check";
    const difference = Math.abs(rh - alp);
    const percent = (difference / Math.abs(rh)) * 100;
    return percent <= 0.25 ? `Cross-check OK · Δ ${difference.toFixed(2)}` : `Feeds differ ${percent.toFixed(2)}%`;
  }

  function renderLiveWatchlist() {
    if (!watchlistIsVisible()) return;
    installLiveWatchlistToolbar();
    const table = document.getElementById("watchlistTable");
    if (!table) return;
    if (!watchlist.length) {
      table.innerHTML = '<p class="muted">No symbols in the watchlist.</p>';
      return;
    }

    table.innerHTML = watchlist.map((symbol) => {
      const selected = selectLiveQuote(symbol);
      const quote = selected.quote || {};
      const price = finiteOrNull(quote.price);
      const bid = finiteOrNull(quote.bidPrice);
      const ask = finiteOrNull(quote.askPrice);
      const age = quoteAgeSeconds(quote.timestamp);
      const badgeClass = price === null ? "unavailable" : age !== null && age > 60 ? "aged" : "";
      const badgeText = price === null ? "NO DATA" : age !== null && age > 60 ? "AGED" : "LIVE";
      return `
        <div class="live-watchlist-row">
          <div class="live-watchlist-symbol"><strong>${escapeHtml(symbol)}</strong><span class="live-watchlist-badge ${badgeClass}">${badgeText}</span></div>
          <div class="live-watchlist-price">${price === null ? "Unavailable" : formatCurrency(price)}</div>
          <div class="live-watchlist-detail"><span>Bid / Ask: ${bid === null ? "--" : formatCurrency(bid)} / ${ask === null ? "--" : formatCurrency(ask)}</span><small>${escapeHtml(crossCheckText(symbol))}</small></div>
          <div class="live-watchlist-detail"><span>${escapeHtml(selected.provider)}</span><small>${escapeHtml(ageLabel(age))}</small></div>
          <button type="button" data-live-remove-symbol="${escapeHtml(symbol)}">Remove</button>
        </div>`;
    }).join("");

    table.querySelectorAll("[data-live-remove-symbol]").forEach((button) => {
      button.addEventListener("click", () => {
        watchlist = watchlist.filter((symbol) => symbol !== button.dataset.liveRemoveSymbol);
        saveStoredJson(STORAGE_KEYS.watchlist, watchlist);
        delete robinhoodLiveQuotes[button.dataset.liveRemoveSymbol];
        delete alpacaLiveQuotes[button.dataset.liveRemoveSymbol];
        renderLiveWatchlist();
      });
    });
  }

  function setLiveWatchlistStatus(text, note, tone = "neutral") {
    installLiveWatchlistToolbar();
    const status = document.getElementById("liveWatchlistModeStatus");
    const detail = document.getElementById("liveWatchlistModeNote");
    if (status) {
      status.textContent = text;
      status.classList.remove("positive", "negative");
      if (tone === "positive") status.classList.add("positive");
      if (tone === "negative") status.classList.add("negative");
    }
    if (detail) detail.textContent = note;
  }

  async function fetchRobinhoodLiveWatchlist() {
    if (!watchlistIsVisible() || robinhoodBusy || !watchlist.length) return;
    robinhoodBusy = true;
    try {
      const result = await apiFetchJson(`/api/quotes?symbols=${encodeURIComponent(watchlist.join(","))}&broker=robinhood`);
      const next = {};
      safeArray(result.data).forEach((quote) => {
        const symbol = normalizeTicker(quote.symbol || quote.ticker);
        if (symbol) next[symbol] = quote;
      });
      robinhoodLiveQuotes = next;
      quotes = { ...quotes, ...next };
      robinhoodFailures = 0;
      robinhoodRequestFailed = false;
      setText("quoteStatus", "Live (Robinhood · 1s)");
      setText("lastQuoteUpdate", formatTimestamp(result.data_as_of || new Date().toISOString()));
      setLiveWatchlistStatus("LIVE MODE", currentUser ? "Robinhood 1s · Alpaca IEX 5s" : "Robinhood 1s · sign in for Alpaca verification", "positive");
    } catch (error) {
      robinhoodFailures += 1;
      robinhoodRequestFailed = true;
      setLiveWatchlistStatus("LIVE MODE DEGRADED", `Robinhood retry backoff · ${error.message}`, "negative");
    } finally {
      robinhoodBusy = false;
      renderLiveWatchlist();
    }
  }

  async function fetchAlpacaLiveWatchlist() {
    if (!watchlistIsVisible() || alpacaBusy || !currentUser || !watchlist.length) return;
    alpacaBusy = true;
    try {
      const result = await apiFetchJson(`/api/alpaca/live?symbols=${encodeURIComponent(watchlist.join(","))}`);
      const next = {};
      safeArray(result.data).forEach((quote) => {
        const symbol = normalizeTicker(quote.symbol);
        if (symbol) next[symbol] = quote;
      });
      alpacaLiveQuotes = next;
    } catch (error) {
      console.warn("Alpaca live watchlist verification unavailable:", error);
    } finally {
      alpacaBusy = false;
      renderLiveWatchlist();
    }
  }

  function nextRobinhoodDelay() {
    if (robinhoodFailures >= 5) return 5_000;
    if (robinhoodFailures >= 2) return 2_500;
    return LIVE_RH_INTERVAL_MS;
  }

  async function robinhoodLoop() {
    if (!liveWatchlistRunning || !watchlistIsVisible()) return;
    await fetchRobinhoodLiveWatchlist();
    robinhoodTimer = window.setTimeout(robinhoodLoop, nextRobinhoodDelay());
  }

  async function alpacaLoop() {
    if (!liveWatchlistRunning || !watchlistIsVisible()) return;
    await fetchAlpacaLiveWatchlist();
    alpacaTimer = window.setTimeout(alpacaLoop, LIVE_ALPACA_INTERVAL_MS);
  }

  function startLiveWatchlist() {
    if (liveWatchlistRunning || !watchlistIsVisible()) return;
    liveWatchlistRunning = true;
    robinhoodFailures = 0;
    setLiveWatchlistStatus("STARTING LIVE MODE", "Loading Robinhood and Alpaca feeds...");
    robinhoodLoop();
    alpacaLoop();
  }

  function stopLiveWatchlist() {
    if (!liveWatchlistRunning) {
      if (!document.hidden) setLiveWatchlistStatus("Live Mode Paused", "Open Watchlist to resume.");
      return;
    }
    liveWatchlistRunning = false;
    window.clearTimeout(robinhoodTimer);
    window.clearTimeout(alpacaTimer);
    robinhoodTimer = null;
    alpacaTimer = null;
    setLiveWatchlistStatus("Live Mode Paused", document.hidden ? "Paused while this tab is hidden." : "Paused outside Watchlist.");
  }

  function reconcileLiveWatchlist() {
    if (watchlistIsVisible()) startLiveWatchlist();
    else stopLiveWatchlist();
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
        if (watchlistIsVisible()) {
          await Promise.allSettled([fetchRobinhoodLiveWatchlist(), fetchAlpacaLiveWatchlist()]);
        }
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

    if (typeof renderQuotes === "function") {
      const baseRenderQuotes = renderQuotes;
      renderQuotes = function renderQuotesWithLiveWatchlist() {
        baseRenderQuotes();
        if (watchlistIsVisible()) renderLiveWatchlist();
      };
    }

    if (typeof activateDashboardSection === "function") {
      const baseActivateDashboardSection = activateDashboardSection;
      activateDashboardSection = function activateDashboardSectionWithLiveMode(sectionId) {
        baseActivateDashboardSection(sectionId);
        window.setTimeout(reconcileLiveWatchlist, 0);
      };
      globalThis.activateDashboardSection = activateDashboardSection;
    }

    installLiveWatchlistStyles();
    installLiveWatchlistToolbar();
    document.addEventListener("visibilitychange", reconcileLiveWatchlist);
    window.addEventListener("pagehide", stopLiveWatchlist);
    window.addEventListener("pageshow", reconcileLiveWatchlist);

    scheduleAlpacaSidebarCheck();
    window.setInterval(checkAlpacaSidebarStatus, 5 * 60_000);
    window.setTimeout(reconcileLiveWatchlist, 0);
  }

  window.setTimeout(() => {
    if (typeof fetchQuotes === "function") fetchQuotes();
  }, 0);
})();
