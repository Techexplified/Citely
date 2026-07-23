/**
 * Citely AI attribution stub.
 * Detects AI referrers / UTM hints and stamps cart attributes for later order webhooks.
 */
(function () {
  var AI_HOST_HINTS = [
    "chat.openai.com",
    "chatgpt.com",
    "perplexity.ai",
    "gemini.google.com",
    "bard.google.com",
    "copilot.microsoft.com",
    "claude.ai",
    "grok.x.ai",
    "you.com",
  ];

  function detectEngine(referrer, search) {
    var params = new URLSearchParams(search || "");
    var utmSource = (params.get("utm_source") || "").toLowerCase();
    var utmMedium = (params.get("utm_medium") || "").toLowerCase();

    if (utmSource.includes("chatgpt") || utmSource.includes("openai")) return "ChatGPT";
    if (utmSource.includes("perplexity")) return "Perplexity";
    if (utmSource.includes("gemini") || utmSource.includes("bard")) return "Gemini";
    if (utmSource.includes("copilot")) return "Copilot";
    if (utmSource.includes("claude")) return "Claude";
    if (utmMedium === "ai" && utmSource) return utmSource;

    try {
      if (!referrer) return null;
      var host = new URL(referrer).hostname.toLowerCase();
      for (var i = 0; i < AI_HOST_HINTS.length; i++) {
        if (host === AI_HOST_HINTS[i] || host.endsWith("." + AI_HOST_HINTS[i])) {
          if (host.includes("openai") || host.includes("chatgpt")) return "ChatGPT";
          if (host.includes("perplexity")) return "Perplexity";
          if (host.includes("gemini") || host.includes("bard")) return "Gemini";
          if (host.includes("copilot")) return "Copilot";
          if (host.includes("claude")) return "Claude";
          if (host.includes("grok")) return "Grok";
          return host;
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function persistEngine(engine) {
    try {
      window.sessionStorage.setItem("citely_ai_engine", engine);
      window.localStorage.setItem("citely_ai_engine", engine);
    } catch (e) {}
  }

  function readEngine() {
    try {
      return (
        window.sessionStorage.getItem("citely_ai_engine") ||
        window.localStorage.getItem("citely_ai_engine")
      );
    } catch (e) {
      return null;
    }
  }

  function stampCart(engine) {
    if (!engine || !window.fetch) return;
    var body = JSON.stringify({
      attributes: {
        citely_ai_engine: engine,
        citely_ai_attributed: "true",
      },
    });

    fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body,
      credentials: "same-origin",
    }).catch(function () {});
  }

  var detected = detectEngine(document.referrer, window.location.search);
  if (detected) persistEngine(detected);
  var engine = detected || readEngine();
  if (engine) stampCart(engine);
})();
