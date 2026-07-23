/* Add an owner-only, read-only trading research assistant to the dashboard. */
(() => {
  const SECTION_ID = "assistant";
  const STATUS_ID = "assistantStatus";
  const MESSAGE_LIST_ID = "assistantMessages";
  const FORM_ID = "assistantForm";
  const INPUT_ID = "assistantInput";
  const CLEAR_ID = "clearAssistantBtn";
  const MAX_HISTORY_ITEMS = 8;

  let assistantConfigured = false;
  let assistantConfigChecked = false;
  let assistantConfigBusy = false;
  let assistantBusy = false;
  let conversation = [];

  function ensureAssistantStyles() {
    if (document.getElementById("assistantStyles")) return;
    const style = document.createElement("style");
    style.id = "assistantStyles";
    style.textContent = `
      .assistant-layout {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr);
        gap: 18px;
      }
      .assistant-chat {
        min-height: 420px;
        display: flex;
        flex-direction: column;
      }
      .assistant-messages {
        display: grid;
        gap: 12px;
        min-height: 280px;
        max-height: 560px;
        overflow-y: auto;
        padding: 4px 2px 16px;
      }
      .assistant-message {
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .assistant-message-user {
        background: var(--surface-strong);
        color: var(--text);
        margin-left: min(12%, 80px);
      }
      .assistant-message-bot {
        background: var(--card);
        color: var(--text);
        margin-right: min(8%, 60px);
      }
      .assistant-message-label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 7px;
        opacity: .68;
        text-transform: uppercase;
      }
      .assistant-form {
        display: grid;
        gap: 10px;
        margin-top: auto;
      }
      .assistant-form textarea {
        width: 100%;
        min-height: 96px;
        resize: vertical;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
        font: inherit;
        background: var(--input-bg);
        color: var(--text);
        -webkit-text-fill-color: var(--text);
        caret-color: var(--text);
      }
      .assistant-form textarea::placeholder {
        color: var(--muted);
        -webkit-text-fill-color: var(--muted);
        opacity: 1;
      }
      .assistant-actions,
      .assistant-quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .assistant-actions button,
      .assistant-quick-actions button {
        border: none;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 700;
      }
      .assistant-actions button[type="submit"] {
        background: var(--accent);
        color: #fff;
      }
      .assistant-actions button[type="button"],
      .assistant-quick-actions button {
        background: var(--surface);
        color: var(--text);
        -webkit-text-fill-color: var(--text);
        border: 1px solid var(--border-strong);
      }
      .assistant-actions button[type="button"]:not(:disabled):hover,
      .assistant-quick-actions button:not(:disabled):hover {
        background: var(--surface-hover);
        color: #fff;
        -webkit-text-fill-color: #fff;
      }
      .assistant-actions button:disabled,
      .assistant-quick-actions button:disabled,
      .assistant-form textarea:disabled {
        cursor: not-allowed;
        opacity: .7;
        color: var(--text-secondary);
        -webkit-text-fill-color: var(--text-secondary);
      }
      .assistant-context-list {
        display: grid;
        gap: 10px;
      }
      .assistant-context-item {
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
      }
      .assistant-context-item strong,
      .assistant-context-item span {
        display: block;
      }
      .assistant-context-item span {
        font-size: 12px;
        margin-top: 5px;
        opacity: .68;
      }
      @media (max-width: 900px) {
        .assistant-layout { grid-template-columns: 1fr; }
        .assistant-message-user,
        .assistant-message-bot { margin-left: 0; margin-right: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureAssistantNavigation() {
    const navigation = document.querySelector(".side-nav");
    if (!navigation || navigation.querySelector('[data-section="assistant"]')) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-btn";
    button.dataset.section = SECTION_ID;
    button.textContent = "AI Assistant";

    const activityButton = navigation.querySelector('[data-section="activity"]');
    if (activityButton) navigation.insertBefore(button, activityButton);
    else navigation.appendChild(button);
  }

  function ensureAssistantSection() {
    if (document.getElementById(SECTION_ID)) return;
    const main = document.querySelector(".main-content");
    if (!main) return;

    const section = document.createElement("section");
    section.id = SECTION_ID;
    section.className = "page-section";
    section.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>AI Trading Assistant</h3>
            <p>Read-only research using your dashboard context and server-fetched ticker quotes.</p>
          </div>
          <span id="${STATUS_ID}" class="status-pill status-coming">Checking</span>
        </div>
        <div class="assistant-layout">
          <div class="assistant-chat">
            <div id="${MESSAGE_LIST_ID}" class="assistant-messages" aria-live="polite"></div>
            <form id="${FORM_ID}" class="assistant-form">
              <label for="${INPUT_ID}"><strong>Ask about your watchlist or portfolio</strong></label>
              <textarea id="${INPUT_ID}" maxlength="2000" placeholder="Example: Review my watchlist and explain the biggest risks shown by the current data."></textarea>
              <div class="assistant-actions">
                <button type="submit">Ask Assistant</button>
                <button id="${CLEAR_ID}" type="button">Clear Conversation</button>
              </div>
            </form>
          </div>
          <aside>
            <div class="assistant-context-list">
              <div class="assistant-context-item">
                <strong>Read-only</strong>
                <span>The assistant cannot place, change, approve, or cancel trades.</span>
              </div>
              <div class="assistant-context-item">
                <strong id="assistantQuoteContext">Ticker context unavailable</strong>
                <span id="assistantQuoteContextNote">Waiting for the live quote feed.</span>
              </div>
              <div class="assistant-context-item">
                <strong id="assistantPortfolioContext">Portfolio context hidden</strong>
                <span id="assistantPortfolioContextNote">Sign in to use connected account context.</span>
              </div>
            </div>
            <div class="assistant-quick-actions" style="margin-top: 14px;">
              <button type="button" data-assistant-prompt="Review my watchlist using the available live quotes. Separate the observed data from your interpretation.">Review Watchlist</button>
              <button type="button" data-assistant-prompt="Review my connected portfolio for concentration, cash allocation, and position-size risk.">Review Portfolio Risk</button>
              <button type="button" data-assistant-prompt="Explain what the current dashboard data does and does not tell me before I make a trade.">Check My Trade Context</button>
            </div>
          </aside>
        </div>
      </section>
    `;

    const activity = document.getElementById("activity");
    if (activity) main.insertBefore(section, activity);
    else main.appendChild(section);
  }

  function appendMessage(role, content) {
    const list = document.getElementById(MESSAGE_LIST_ID);
    if (!list) return null;

    const article = document.createElement("article");
    article.className = `assistant-message assistant-message-${role === "user" ? "user" : "bot"}`;

    const label = document.createElement("span");
    label.className = "assistant-message-label";
    label.textContent = role === "user" ? "You" : "Assistant";

    const body = document.createElement("div");
    body.textContent = content;

    article.append(label, body);
    list.appendChild(article);
    list.scrollTop = list.scrollHeight;
    return article;
  }

  function renderWelcome() {
    const list = document.getElementById(MESSAGE_LIST_ID);
    if (!list || list.children.length) return;
    appendMessage(
      "assistant",
      "Sign in, make sure the API is configured, then ask about your watchlist or connected portfolio. Current prices are used only when the server returns ticker quotes with the request.",
    );
  }

  function setAssistantStatus(text, connected = false) {
    setStatus(STATUS_ID, text, connected);
  }

  function buildPortfolioContext() {
    return {
      total_value: optionalFiniteNumber(portfolio.total_value),
      cash: optionalFiniteNumber(portfolio.cash),
      buying_power: optionalFiniteNumber(portfolio.buying_power),
      invested_value: optionalFiniteNumber(portfolio.invested_value),
      day_change: optionalFiniteNumber(portfolio.day_change),
      day_change_percent: optionalFiniteNumber(portfolio.day_change_percent),
      data_as_of: portfolio.data_as_of || null,
      retrieved_at: portfolio.retrieved_at || null,
      holdings: safeArray(portfolio.holdings).slice(0, 30).map((holding) => ({
        symbol: holding.symbol || holding.option_symbol || "",
        quantity: optionalFiniteNumber(holding.quantity),
        current_price: optionalFiniteNumber(holding.current_price),
        average_price: optionalFiniteNumber(holding.average_price),
        market_value: optionalFiniteNumber(holding.market_value),
        asset_type: holding.asset_type || holding.type || null,
        account_name: holding.account_name || null,
      })),
    };
  }

  function renderAssistantContext() {
    const quoteSymbols = Object.keys(quotes).filter((symbol) => optionalFiniteNumber(quotes[symbol]?.price) !== null);
    setText(
      "assistantQuoteContext",
      quoteSymbols.length
        ? `${quoteSymbols.length} ticker quote${quoteSymbols.length === 1 ? "" : "s"} available`
        : "Ticker context unavailable",
    );
    setText(
      "assistantQuoteContextNote",
      quoteSymbols.length
        ? `Latest dashboard quote update: ${document.getElementById("lastQuoteUpdate")?.textContent || "unavailable"}.`
        : "The assistant will still ask the API for the current watchlist when you submit a message.",
    );

    const connectedAccounts = safeArray(portfolio.accounts).length;
    setText(
      "assistantPortfolioContext",
      currentUser && connectedAccounts
        ? `${connectedAccounts} connected account${connectedAccounts === 1 ? "" : "s"}`
        : "Portfolio context hidden",
    );
    setText(
      "assistantPortfolioContextNote",
      currentUser && connectedAccounts
        ? `Portfolio data as of ${formatTimestamp(portfolio.data_as_of)}.`
        : "Sign in and connect a brokerage to use account context.",
    );
  }

  function setAssistantControls() {
    const canUse = Boolean(currentUser && assistantConfigured && !assistantBusy);
    const input = document.getElementById(INPUT_ID);
    const submit = document.querySelector(`#${FORM_ID} button[type="submit"]`);
    const quickButtons = document.querySelectorAll("[data-assistant-prompt]");

    if (input) input.disabled = !canUse;
    if (submit) {
      submit.disabled = !canUse;
      submit.textContent = assistantBusy ? "Thinking..." : "Ask Assistant";
    }
    quickButtons.forEach((button) => {
      button.disabled = !canUse;
    });

    if (!currentUser) setAssistantStatus("Sign In Required");
    else if (!assistantConfigChecked || assistantConfigBusy) setAssistantStatus("Checking");
    else if (!assistantConfigured) setAssistantStatus("API Key Required");
    else if (assistantBusy) setAssistantStatus("Working", true);
    else setAssistantStatus("Ready", true);
  }

  async function checkAssistantConfig(force = false) {
    if (!currentUser) {
      assistantConfigured = false;
      assistantConfigChecked = false;
      setAssistantControls();
      return;
    }
    if (assistantConfigBusy || (assistantConfigChecked && !force)) return;

    assistantConfigBusy = true;
    setAssistantControls();
    try {
      const result = await apiFetchJson("/api/assistant/config");
      assistantConfigured = Boolean(result.configured);
      assistantConfigChecked = true;
      if (!assistantConfigured) {
        appendMessage(
          "assistant",
          "The AI service is not configured yet. Add OPENAI_API_KEY to the Replit API secrets, then republish the API.",
        );
      }
    } catch (error) {
      assistantConfigured = false;
      assistantConfigChecked = true;
      appendMessage("assistant", `Assistant configuration check failed: ${error.message}`);
    } finally {
      assistantConfigBusy = false;
      setAssistantControls();
    }
  }

  async function submitAssistantMessage(message) {
    const cleanMessage = String(message || "").trim().slice(0, 2000);
    if (!cleanMessage || assistantBusy) return;
    if (!currentUser) {
      appendMessage("assistant", "Sign in before using the private trading assistant.");
      return;
    }

    if (!assistantConfigChecked) await checkAssistantConfig();
    if (!assistantConfigured) {
      appendMessage(
        "assistant",
        "The API needs an OPENAI_API_KEY secret before the assistant can answer.",
      );
      return;
    }

    const priorHistory = conversation.slice(-MAX_HISTORY_ITEMS);
    appendMessage("user", cleanMessage);
    const pending = appendMessage("assistant", "Reviewing the current dashboard context...");
    assistantBusy = true;
    setAssistantControls();

    // Deterministic projection-intent detection (shared with ai-assistant.js).
    // When the message asks for a forward-looking ticker projection, the
    // server computes and attaches exact projections instead of letting the
    // AI guess numbers.
    const projectionHooks = globalThis.__anyTickerProjection || null;
    const portfolioContextData = buildPortfolioContext();
    let projectionIntent = { intent: false, symbols: [] };
    if (projectionHooks && typeof projectionHooks.detectProjectionIntent === "function") {
      const knownSymbols = [
        ...watchlist,
        ...portfolioContextData.holdings.map((holding) => holding.symbol),
      ];
      projectionIntent = projectionHooks.detectProjectionIntent(cleanMessage, knownSymbols);
    }

    try {
      const requestBody = {
        message: cleanMessage,
        symbols: watchlist.slice(0, 12),
        history: priorHistory,
        portfolio: portfolioContextData,
      };
      if (projectionIntent.intent) {
        requestBody.include_ticker_projection = true;
        requestBody.projection_symbols = projectionIntent.symbols;
      }
      const result = await apiFetchJson("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const answer = String(result.data?.answer || "").trim();
      if (!answer) throw new Error("The assistant returned an empty answer");

      pending?.remove();
      const tickerProjection = result.data?.ticker_projection;
      if (
        tickerProjection &&
        Array.isArray(tickerProjection.candidates) &&
        projectionHooks &&
        typeof projectionHooks.renderTickerProjectionResult === "function"
      ) {
        // Deterministic server-computed cards first, then the AI's explanation.
        projectionHooks.renderTickerProjectionResult(tickerProjection);
      } else if (projectionIntent.intent && result.data?.ticker_projection_status) {
        appendMessage("assistant", String(result.data.ticker_projection_status));
      }
      appendMessage("assistant", answer);
      conversation.push(
        { role: "user", content: cleanMessage },
        { role: "assistant", content: answer },
      );
      conversation = conversation.slice(-MAX_HISTORY_ITEMS);

      const quoteCount = finiteNumber(result.data?.quote_count, 0);
      setText(
        "assistantQuoteContext",
        quoteCount
          ? `${quoteCount} server-fetched quote${quoteCount === 1 ? "" : "s"} used`
          : "No server-fetched quotes used",
      );
      setText(
        "assistantQuoteContextNote",
        result.data?.generated_at
          ? `Assistant context generated ${formatTimestamp(result.data.generated_at)}.`
          : "Assistant context timestamp unavailable.",
      );
    } catch (error) {
      pending?.remove();
      appendMessage("assistant", `Assistant unavailable: ${error.message}`);
    } finally {
      assistantBusy = false;
      setAssistantControls();
    }
  }

  function setupAssistantEvents() {
    document.getElementById(FORM_ID)?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById(INPUT_ID);
      const message = input?.value || "";
      if (input) input.value = "";
      submitAssistantMessage(message);
    });

    document.getElementById(CLEAR_ID)?.addEventListener("click", () => {
      conversation = [];
      const list = document.getElementById(MESSAGE_LIST_ID);
      if (list) list.innerHTML = "";
      // The cleared DOM no longer shows projection cards, so reset the
      // "already rendered" dedupe state to force full re-rendering.
      globalThis.__anyTickerProjection?.resetRenderState?.();
      renderWelcome();
    });

    document.querySelectorAll("[data-assistant-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        submitAssistantMessage(button.dataset.assistantPrompt || "");
      });
    });
  }

  ensureAssistantStyles();
  ensureAssistantNavigation();
  ensureAssistantSection();
  setupAssistantEvents();
  renderWelcome();
  renderAssistantContext();
  setAssistantControls();

  const baseRenderAuth = renderAuth;
  renderAuth = function renderAuthWithAssistantAccess() {
    baseRenderAuth();
    if (!currentUser) {
      assistantConfigured = false;
      assistantConfigChecked = false;
    }
    setAssistantControls();
    if (currentUser) checkAssistantConfig();
  };

  const baseRenderPortfolio = renderPortfolio;
  renderPortfolio = function renderPortfolioWithAssistantContext() {
    baseRenderPortfolio();
    renderAssistantContext();
  };

  const baseRenderQuotes = renderQuotes;
  renderQuotes = function renderQuotesWithAssistantContext() {
    baseRenderQuotes();
    renderAssistantContext();
  };
})();
