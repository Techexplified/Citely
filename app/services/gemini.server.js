const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** Cheap Flash-Lite default — enough for content / research. */
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

/** OpenRouter id used when the direct Gemini API is quota-blocked. */
export const OPENROUTER_GEMINI_MODEL = "google/gemini-3.5-flash-lite";

const GEMINI_FALLBACK_MODELS = [
  GEMINI_DEFAULT_MODEL,
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
}

function extractGroundingSources(payload) {
  const chunks =
    payload?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = [];

  for (const chunk of chunks) {
    const web = chunk?.web || chunk?.retrievedContext;
    const url = web?.uri || web?.url;
    if (!url) continue;
    sources.push({
      url: String(url),
      title: String(web?.title || "").trim() || null,
    });
  }

  return sources;
}

function isQuotaError(status, message = "") {
  return (
    status === 429 ||
    /quota|rate.?limit|resource.?exhausted/i.test(String(message))
  );
}

function isMissingModel(status, message = "") {
  return (
    status === 404 ||
    /no longer available|is not found|not supported for generateContent/i.test(
      String(message),
    )
  );
}

async function generateOnce({
  apiKey,
  model,
  contents,
  systemParts,
  temperature,
  max_tokens,
  webSearch,
}) {
  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens,
    },
  };

  if (systemParts.length) {
    body.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  if (webSearch) {
    body.tools = [{ google_search: {} }];
  }

  const response = await fetch(
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
  );

  const payload = await response.json().catch(() => ({}));
  const message =
    payload?.error?.message ||
    payload?.message ||
    `Gemini request failed (${response.status})`;

  return { response, payload, message };
}

/**
 * Chat-style completion against the Gemini generateContent API.
 * Accepts OpenAI-style messages and returns { content, sources, raw }.
 *
 * If Google Search grounding is quota-blocked, retries without search so
 * Gemini-only scans still complete during App Store review.
 */
export async function geminiChatCompletion({
  model = getGeminiModel(),
  messages = [],
  temperature = 0.2,
  max_tokens = 400,
  webSearch = true,
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Gemini isn’t configured. Add GEMINI_API_KEY to enable this engine.",
    );
  }

  const systemParts = [];
  const contents = [];

  for (const message of messages) {
    const text = String(message?.content || "").trim();
    if (!text) continue;

    if (message.role === "system") {
      systemParts.push(text);
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }

  if (!contents.length) {
    throw new Error("Gemini request is missing user content.");
  }

  const tried = new Set();
  const modelsToTry = [model, ...GEMINI_FALLBACK_MODELS].filter((id) => {
    if (!id || tried.has(id)) return false;
    tried.add(id);
    return true;
  });

  let lastError = "Gemini request failed";
  let searchEnabled = Boolean(webSearch);

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const candidate = modelsToTry[i];
    const { response, payload, message } = await generateOnce({
      apiKey,
      model: candidate,
      contents,
      systemParts,
      temperature,
      max_tokens,
      webSearch: searchEnabled,
    });

    if (!response.ok) {
      lastError = message;
      if (isMissingModel(response.status, message)) continue;
      if (isQuotaError(response.status, message) && searchEnabled) {
        console.warn(
          `Gemini search quota hit (${candidate}); retrying without Google Search.`,
        );
        searchEnabled = false;
        i -= 1;
        continue;
      }
      throw new Error(message);
    }

    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const content = parts
      .map((part) => part?.text || "")
      .join("")
      .trim();

    if (!content) {
      const blockReason =
        payload?.promptFeedback?.blockReason ||
        payload?.candidates?.[0]?.finishReason;
      lastError = blockReason
        ? `Gemini returned no content (${blockReason})`
        : "Gemini returned an empty response";

      if (searchEnabled) {
        searchEnabled = false;
        i -= 1;
        continue;
      }
      continue;
    }

    return {
      content,
      sources: [
        ...extractGroundingSources(payload),
        ...extractUrlsFromText(content),
      ]
        .filter(
          (source, index, list) =>
            list.findIndex((item) => item.url === source.url) === index,
        )
        .slice(0, 8),
      raw: payload,
    };
  }

  throw new Error(lastError);
}

function extractUrlsFromText(content = "") {
  const matches = String(content).match(/https?:\/\/[^\s"'<>\]]+/g) || [];
  const sources = [];
  const seen = new Set();
  for (const raw of matches) {
    const url = raw.replace(/[),.;]+$/g, "");
    if (!url || seen.has(url) || url.length > 180) continue;
    seen.add(url);
    sources.push({ url, title: null });
  }
  return sources.slice(0, 8);
}
