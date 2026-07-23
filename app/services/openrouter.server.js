const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_ENGINES = {
  ChatGPT: "openai/gpt-4o-mini",
  Gemini: "google/gemini-2.0-flash-001",
  Perplexity: "perplexity/sonar",
};

export function isOpenRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

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
  return { ...DEFAULT_ENGINES };
}

export async function chatCompletion({ model, messages, temperature = 0.2 }) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI scanning isn’t available right now. Try again later or contact support.",
    );
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.SHOPIFY_APP_URL || "https://citely.app",
      "X-Title": "Citely",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
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

  return { content, raw: payload };
}
