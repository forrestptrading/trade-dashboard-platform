/* Dark burgundy dashboard theme and safe rich formatting for AI responses. */
(() => {
  const STYLE_ID = "dashboardPolishStyles";
  const FORMATTED_ATTR = "data-rich-formatted";
  function installTheme() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `:root{color-scheme:dark !important;--bg:#120a0d;--card:#211116;--surface:#2a171d;--surface-strong:#351b23;--sidebar:#5b0f17;--sidebar-hover:#7b1825;--accent:#a92d40;--accent-hover:#c53b50;--border:#4a252f;--text:#f7eef0;--muted:#c8aeb4;--green:#4dd47a;--red:#ff6b78;--shadow:0 16px 38px rgba(0,0,0,.34);}html,body{min-height:100%;background:#120a0d !important;}body{color:var(--text) !important;background:radial-gradient(circle at 88% 4%,rgba(139,29,44,.22),transparent 34%),radial-gradient(circle at 30% 100%,rgba(91,15,23,.18),transparent 36%),linear-gradient(145deg,#120a0d 0%,#180c11 48%,#10080b 100%) !important;}.app-shell,.main-content,.dashboard{background:transparent !important;}.main-content{flex:1;min-width:0;padding:24px;}.sidebar{background:linear-gradient(180deg,#67121d 0%,var(--sidebar) 48%,#3d0a10 100%) !important;border-right:1px solid rgba(255,255,255,.08);box-shadow:14px 0 36px rgba(0,0,0,.28);}.brand-icon{background:#f8eef0 !important;box-shadow:0 8px 20px rgba(0,0,0,.22);}.nav-btn{border:1px solid transparent !important;}.nav-btn:hover,.nav-btn.active{background:rgba(255,255,255,.1) !important;border-color:rgba(255,255,255,.1) !important;transform:translateX(2px);}.topbar{padding:2px 2px 0;}.topbar h2,h1,h2,h3,h4,label,strong{color:var(--text);}.topbar p,.panel-header p,small,.muted{color:var(--muted) !important;opacity:1 !important;}.panel,.summary-card{background:linear-gradient(145deg,rgba(42,23,29,.98),rgba(31,16,21,.98)) !important;border-color:var(--border) !important;box-shadow:var(--shadow) !important;}.summary-card{position:relative;overflow:hidden;}.summary-card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(180deg,var(--accent-hover),var(--accent));}.aggregate-portfolio-card,.quote-card,.account-card,.broker-card,.broker-engine-card,.table-row,.journal-entry,#tradeApprovalCard,.approval-item,.setting-card,#riskAnalysisBox,.workspace-card,.news-item,.timeline-item,.workspace-table-row,.heat-map-tile,.assistant-context-item{background:var(--surface) !important;color:var(--text) !important;border-color:var(--border) !important;box-shadow:0 10px 24px rgba(0,0,0,.18);}body input,body textarea,body select,.workspace-search,.assistant-form textarea{background:#190d12 !important;color:var(--text) !important;-webkit-text-fill-color:var(--text) !important;caret-color:#ffffff !important;border-color:var(--border) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025);}body input::placeholder,body textarea::placeholder{color:#a98e95 !important;-webkit-text-fill-color:#a98e95 !important;opacity:1 !important;}body input:-webkit-autofill,body input:-webkit-autofill:hover,body input:-webkit-autofill:focus{-webkit-text-fill-color:var(--text) !important;box-shadow:0 0 0 1000px #190d12 inset !important;caret-color:#ffffff !important;}button{transition:transform .18s ease,filter .18s ease,background .18s ease,border-color .18s ease;}button:not(:disabled):hover{filter:brightness(1.12);transform:translateY(-1px);}#refreshDataBtn,.inline-form button,.assistant-actions button[type="submit"]{background:linear-gradient(135deg,var(--accent-hover),var(--accent)) !important;color:#fff !important;border:1px solid rgba(255,255,255,.1) !important;box-shadow:0 8px 18px rgba(139,29,44,.3);}.assistant-actions button[type="button"],.assistant-quick-actions button,.table-row button{background:#3a2028 !important;color:var(--text) !important;border:1px solid var(--border) !important;}.status-coming{background:#4a2e18 !important;color:#ffd28c !important;}.status-connected{background:#123e27 !important;color:#79e49b !important;}.status-disconnected{background:#4a171e !important;color:#ff9ca5 !important;}.assistant-layout{grid-template-columns:minmax(0,2.2fr) minmax(250px,.8fr) !important;gap:20px !important;}.assistant-chat{min-height:500px !important;}.assistant-messages{gap:16px !important;max-height:620px !important;padding:4px 6px 20px 2px !important;scrollbar-color:var(--accent) #1a0d12;}.assistant-message{position:relative;border-radius:16px !important;padding:16px 18px !important;line-height:1.65 !important;white-space:normal !important;border:1px solid var(--border) !important;box-shadow:0 12px 28px rgba(0,0,0,.2);animation:assistantMessageIn .22s ease-out;}.assistant-message-user{background:linear-gradient(145deg,#4b1d28,#38151e) !important;border-color:#6d2b39 !important;color:#fff5f6 !important;}.assistant-message-bot{background:linear-gradient(145deg,#2c181e,#211116) !important;border-left:3px solid var(--accent-hover) !important;color:var(--text) !important;}.assistant-message-label{color:#d7b9c0 !important;letter-spacing:.09em;opacity:1 !important;}.assistant-message-body{color:var(--text);}.assistant-rich-text>*:first-child{margin-top:0;}.assistant-rich-text>*:last-child{margin-bottom:0;}.assistant-rich-text p{margin:0 0 12px;}.assistant-rich-text h4{margin:18px 0 8px;color:#ffb7c0;font-size:15px;letter-spacing:.02em;}.assistant-rich-text ul,.assistant-rich-text ol{margin:8px 0 14px 22px;padding:0;}.assistant-rich-text li{margin:6px 0;padding-left:3px;}.assistant-rich-text li::marker{color:#d95569;font-weight:700;}.assistant-rich-text code{display:inline-block;padding:1px 6px;border-radius:6px;background:#14090d;border:1px solid #49222c;color:#ffc4cc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;}.assistant-rich-text strong{color:#ffffff;}.assistant-copy-button{position:absolute;top:10px;right:10px;padding:5px 9px;border-radius:8px;border:1px solid var(--border);background:rgba(17,8,12,.7);color:#d9bdc3;font-size:11px;cursor:pointer;}.assistant-message-bot .assistant-message-label{padding-right:48px;}.assistant-context-item{padding:14px !important;}.assistant-context-item strong{color:#fff3f5 !important;}.assistant-context-item span{color:var(--muted) !important;opacity:1 !important;}@keyframes assistantMessageIn{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:translateY(0);}}::selection{background:rgba(197,59,80,.48);color:#fff;}::-webkit-scrollbar{width:10px;height:10px;}::-webkit-scrollbar-track{background:#160b0f;}::-webkit-scrollbar-thumb{background:#5a2733;border-radius:999px;border:2px solid #160b0f;}@media (max-width:900px){.main-content{padding:16px;}.assistant-layout{grid-template-columns:1fr !important;}.assistant-message-user,.assistant-message-bot{margin-left:0 !important;margin-right:0 !important;}}`;
    document.head.appendChild(style);
  }
  function appendInlineFormatting(parent, value) {
    const text = String(value || "");
    const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
    let lastIndex = 0;
    for (const match of text.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex, index)));
      }
      const token = match[0];
      if (token.startsWith("`")) {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      } else {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      }
      lastIndex = index + token.length;
    }
    if (lastIndex < text.length) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }
  function isHeadingLine(line) {
    const clean = line.trim();
    if (!clean || clean.length > 90) return false;
    if (/^#{1,3}\s+/.test(clean)) return true;
    if (/^(observed data|interpretation|portfolio snapshot|largest positions|concentration risks?|available cash|risk review|key risks?|missing \/ unavailable data|other unusual \/ notable points|bottom line|summary|watchlist review):?$/i.test(clean)) return true;
    return clean.endsWith(":") && !/^https?:/i.test(clean);
  }
  function formatAssistantText(container, rawText) {
    const lines = String(rawText || "").replace(/\r\n/g, "\n").split("\n");
    let activeList = null;
    let activeListType = "";
    function closeList() {
      activeList = null;
      activeListType = "";
    }
    function ensureList(type) {
      if (activeList && activeListType === type) return activeList;
      activeList = document.createElement(type);
      activeListType = type;
      container.appendChild(activeList);
      return activeList;
    }
    for (const originalLine of lines) {
      const line = originalLine.trim();
      if (!line) {
        closeList();
        continue;
      }
      const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
      if (bulletMatch) {
        const item = document.createElement("li");
        appendInlineFormatting(item, bulletMatch[1]);
        ensureList("ul").appendChild(item);
        continue;
      }
      const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
      if (numberedMatch) {
        const item = document.createElement("li");
        appendInlineFormatting(item, numberedMatch[1]);
        ensureList("ol").appendChild(item);
        continue;
      }
      closeList();
      if (isHeadingLine(line)) {
        const heading = document.createElement("h4");
        appendInlineFormatting(
          heading,
          line.replace(/^#{1,3}\s+/, "").replace(/:$/, ""),
        );
        container.appendChild(heading);
        continue;
      }
      const paragraph = document.createElement("p");
      appendInlineFormatting(paragraph, line);
      container.appendChild(paragraph);
    }
  }
  function addCopyButton(article, rawText) {
    if (article.querySelector(".assistant-copy-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-copy-button";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(rawText);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1_500);
    });
    article.appendChild(button);
  }
  function polishMessage(article) {
    if (!(article instanceof HTMLElement)) return;
    if (!article.classList.contains("assistant-message")) return;
    if (article.getAttribute(FORMATTED_ATTR) === "true") return;
    const body = article.querySelector(":scope > div");
    if (!(body instanceof HTMLElement)) return;
    const rawText = body.textContent || "";
    body.classList.add("assistant-message-body");
    if (article.classList.contains("assistant-message-bot")) {
      body.textContent = "";
      body.classList.add("assistant-rich-text");
      formatAssistantText(body, rawText);
      addCopyButton(article, rawText);
    }
    article.setAttribute(FORMATTED_ATTR, "true");
  }
  function polishExistingMessages() {
    document.querySelectorAll(".assistant-message").forEach(polishMessage);
  }
  function watchAssistantMessages() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains("assistant-message")) polishMessage(node);
          node.querySelectorAll?.(".assistant-message").forEach(polishMessage);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  installTheme();
  polishExistingMessages();
  watchAssistantMessages();
})();
