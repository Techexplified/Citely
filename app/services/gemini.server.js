const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/** Lowest-token Flash model that works with this API key + Google Search. */
export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
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

/**
 * Chat-style completion against the Gemini generateContent API.
 * Accepts OpenAI-style messages and returns { content, sources, raw }.
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
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      `Gemini request failed (${response.status})`;
    throw new Error(detail);
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
    throw new Error(
      blockReason
        ? `Gemini returned no content (${blockReason})`
        : "Gemini returned an empty response",
    );
  }

  return {
    content,
    sources: [
      ...extractGroundingSources(payload),
      ...extractUrlsFromText(content),
    ].filter((source, index, list) =>
      list.findIndex((item) => item.url === source.url) === index,
    ).slice(0, 8),
    raw: payload,
  };
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
