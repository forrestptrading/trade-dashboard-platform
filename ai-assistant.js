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

  loadScript("dashboardRuntimeFixesLoader", "dashboard-runtime-fixes.js?v=1.0");
  loadScript("dashboardPolishLoader", "ui-polish.js?v=2.1");
  loadScript("assistantCoreLoader", "ai-assistant-core.js?v=1.1");
})();
