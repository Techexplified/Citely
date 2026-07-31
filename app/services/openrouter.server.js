const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Cheapest OpenAI model with native web search on OpenRouter. */
export const OPENROUTER_CHATGPT_MODEL = "openai/gpt-4.1-nano";

export function isOpenRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/** @deprecated Prefer listAvailableEngines / resolveEnginesForScan from engines.server */
export function getEngineModels() {
  const override = process.env.OPENROUTER_MODELS?.trim();
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to defaults
    }
  }

  const models = {};
  if (isOpenRouterConfigured()) {
    models.ChatGPT = OPENROUTER_CHATGPT_MODEL;
  }
  return models;
}

function extractUrlsFromText(content = "") {
  const matches = String(content).match(/https?:\/\/[^\s"'<>\]]+/g) || [];
  const sources = [];
  const seen = new Set();
  for (const raw of matches) {
    const url = raw.replace(/[),.;]+$/g, "");
    if (!url || seen.has(url)) continue;
    // Skip obviously broken/repeated junk URLs
    if (url.length > 180) continue;
    seen.add(url);
    sources.push({ url, title: null });
  }
  return sources.slice(0, 8);
}

function extractAnnotationSources(payload) {
  const annotations = payload?.choices?.[0]?.message?.annotations || [];
  const sources = [];

  for (const item of annotations) {
    const citation = item?.url_citation || item;
    const url = citation?.url;
    if (!url) continue;
    sources.push({
      url: String(url),
      title: String(citation?.title || "").trim() || null,
    });
  }

  return sources;
}

export async function chatCompletion({
  model,
  messages,
  temperature = 0.2,
  max_tokens = 400,
  webSearch = false,
}) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI scanning isn’t available right now. Try again later or contact support.",
    );
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens,
  };

  if (webSearch) {
    // Server-side web search: model may call search; OpenRouter executes it.
    body.tools = [
      {
        type: "openrouter:web_search",
        parameters: {
          engine: "auto",
          max_results: 3,
          max_uses: 1,
          max_total_results: 3,
          search_context_size: "low",
        },
      },
    ];
    body.max_tool_calls = 1;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.SHOPIFY_APP_URL || "https://citely-fawn.vercel.app",
      "X-Title": "Citely",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      `OpenRouter request failed (${response.status})`;
    throw new Error(detail);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response");
  }

  return {
    content,
    sources: [
      ...extractAnnotationSources(payload),
      ...extractUrlsFromText(content),
    ].filter((source, index, list) =>
      list.findIndex((item) => item.url === source.url) === index,
    ).slice(0, 8),
    raw: payload,
  };
}
