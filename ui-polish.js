/* Safe rich formatting for AI responses (copy buttons, markdown-lite rendering).
   The dashboard theme lives in style.css — no runtime theme injection here. */
(() => {
  const FORMATTED_ATTR = "data-rich-formatted";
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
  polishExistingMessages();
  watchAssistantMessages();
})();
