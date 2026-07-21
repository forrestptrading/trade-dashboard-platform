/* Load dashboard runtime fixes, polish, and the owner-only AI assistant core. */
(() => {
  function loadScript(id, src) {
    if (document.getElementById(id)) return;
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onerror = () => console.error(`Failed to load ${src}`);
    document.head.appendChild(script);
  }

  function openAssistantSection() {
    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.section === "assistant");
    });
    document.querySelectorAll(".page-section").forEach((section) => {
      section.classList.toggle("active-section", section.id === "assistant");
    });
    document.getElementById("assistantInput")?.focus();
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.('[data-section="assistant"]');
    if (!button) return;
    event.preventDefault();
    openAssistantSection();
  });

  loadScript("dashboardRuntimeFixesLoader", "dashboard-runtime-fixes.js?v=1.0");
  loadScript("dashboardPolishLoader", "ui-polish.js?v=2.1");
  loadScript("assistantCoreLoader", "ai-assistant-core.js?v=1.1");
})();