/**
 * AI helpers for one-time onboarding (persona + buying questions).
 * Falls back to templates when no LLM is configured or the call fails.
 */
import {
  chatCompletion,
  isOpenRouterConfigured,
  OPENROUTER_CHATGPT_MODEL,
} from "./openrouter.server";
import {
  geminiChatCompletion,
  getGeminiModel,
  isGeminiConfigured,
} from "./gemini.server";
import {
  nicheLabel,
  templatePersona,
  templatePromptSuggestions,
} from "../utils/onboarding-templates";

async function runLlm(messages, { max_tokens = 400, temperature = 0.5 } = {}) {
  if (isOpenRouterConfigured()) {
    return chatCompletion({
      model: OPENROUTER_CHATGPT_MODEL,
      messages,
      temperature,
      max_tokens,
      webSearch: false,
    });
  }
  if (isGeminiConfigured()) {
    return geminiChatCompletion({
      model: getGeminiModel(),
      messages,
      temperature,
      max_tokens,
      webSearch: false,
    });
  }
  return null;
}

function parsePromptList(content, fallback) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*\d.)]+\s*/, "")
        .replace(/^["']|["']$/g, "")
        .trim(),
    )
    .filter((line) => line.length >= 12 && line.includes("?"));

  const unique = [];
  for (const line of lines) {
    if (!unique.includes(line)) unique.push(line);
    if (unique.length >= 4) break;
  }
  return unique.length ? unique : fallback;
}

/**
 * @returns {{ persona: string, usedAi: boolean }}
 */
export async function generateBuyerPersona({
  storeName,
  niche,
  audience,
  purchasePurpose,
  budget,
}) {
  const fallback = templatePersona({
    storeName,
    audience,
    purchasePurpose,
    budget,
  });

  try {
    const llm = await runLlm(
      [
        {
          role: "system",
          content:
            "You write concise buyer personas for Shopify merchants tracking AI search visibility. 2–4 sentences. No markdown. No bullet lists. Mention that buyers research on AI assistants.",
        },
        {
          role: "user",
          content: [
            `Store: ${storeName || "the store"}`,
            `Niche: ${nicheLabel(niche)}`,
            `Audience: ${audience || "Everyone"}`,
            `Purchase purpose: ${purchasePurpose || "All kinds of purchases"}`,
            `Budget: ${budget || "Mixed buyers"}`,
            "Write the persona in second person (“Your buyer is…”).",
          ].join("\n"),
        },
      ],
      { max_tokens: 220, temperature: 0.55 },
    );

    const persona = String(llm?.content || "").trim();
    if (persona.length >= 40) {
      return { persona, usedAi: true };
    }
  } catch {
    // fall through
  }

  return { persona: fallback, usedAi: false };
}

/**
 * @returns {{ prompts: string[], usedAi: boolean }}
 */
export async function generateBuyingPrompts({
  storeName,
  niche,
  audience,
  persona,
}) {
  const fallback = templatePromptSuggestions(storeName, niche);

  try {
    const llm = await runLlm(
      [
        {
          role: "system",
          content:
            "You invent realistic buyer questions people ask ChatGPT, Gemini, or Perplexity when shopping. Return exactly 4 questions, one per line. No numbering, no quotes, no extra text. Each must end with a question mark.",
        },
        {
          role: "user",
          content: [
            `Store: ${storeName || "the store"}`,
            `Niche: ${nicheLabel(niche)}`,
            `Audience: ${audience || "shoppers"}`,
            persona ? `Buyer persona: ${persona}` : null,
            "Questions should be category/discovery style (not brand-only ads), so we can measure whether AI mentions this store.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { max_tokens: 280, temperature: 0.6 },
    );

    const prompts = parsePromptList(llm?.content, fallback);
    const usedAi =
      Boolean(llm?.content) &&
      prompts.length > 0 &&
      prompts.some((p, i) => p !== fallback[i]);

    return { prompts, usedAi };
  } catch {
    return { prompts: fallback, usedAi: false };
  }
}
