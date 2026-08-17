import {
  chatCompletion as openRouterChat,
  isOpenRouterConfigured,
  OPENROUTER_CHATGPT_MODEL,
} from "./openrouter.server";
import {
  geminiChatCompletion,
  getGeminiModel,
  isGeminiConfigured,
} from "./gemini.server";

/**
 * Catalog of AI engines Citely can scan against.
 * Prefer lowest-token models that still support web search.
 * Perplexity is opt-in via ENABLE_PERPLEXITY=1 (needs OpenRouter).
 */
const ENGINE_CATALOG = [
  {
    id: "ChatGPT",
    label: "ChatGPT",
    provider: "openrouter",
    model: OPENROUTER_CHATGPT_MODEL,
    webSearch: true,
  },
  {
    id: "Gemini",
    label: "Gemini",
    provider: "gemini",
    model: null, // resolved at runtime via GEMINI_MODEL / default
    webSearch: true,
  },
  {
    id: "Perplexity",
    label: "Perplexity",
    provider: "openrouter",
    // Sonar already searches the web; keep tool off to avoid double search cost.
    model: "perplexity/sonar",
    webSearch: false,
    optIn: true,
  },
];

function applyModelOverrides(engines) {
  const override = process.env.OPENROUTER_MODELS?.trim();
  if (!override) return engines;

  try {
    const parsed = JSON.parse(override);
    if (!parsed || typeof parsed !== "object") return engines;

    return engines.map((engine) => {
      const nextModel = parsed[engine.id];
      if (typeof nextModel !== "string" || !nextModel.trim()) return engine;
      return { ...engine, model: nextModel.trim() };
    });
  } catch {
    return engines;
  }
}

function isEngineEnabled(engine) {
  if (!engine.optIn) return true;
  const flag = String(process.env.ENABLE_PERPLEXITY || "")
    .trim()
    .toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function listEngineCatalog() {
  return applyModelOverrides(ENGINE_CATALOG)
    .filter((engine) => isEngineEnabled(engine))
    .map((engine) => {
      const useDirectGemini =
        engine.provider === "gemini" && isGeminiConfigured();
      const available =
        engine.provider === "gemini"
          ? isGeminiConfigured() || isOpenRouterConfigured()
          : isOpenRouterConfigured();

      let model = engine.model;
      if (engine.provider === "gemini") {
        model = useDirectGemini
          ? engine.model || getGeminiModel()
          : OPENROUTER_CHATGPT_MODEL;
      }

      return {
        ...engine,
        model,
        resolveProvider: useDirectGemini
          ? "gemini"
          : engine.provider === "gemini"
            ? "openrouter"
            : engine.provider,
        available,
      };
    });
}

export function listAvailableEngines() {
  return listEngineCatalog().filter((engine) => engine.available);
}

export function isAnyScanEngineConfigured() {
  return listAvailableEngines().length > 0;
}

/**
 * Resolve engines for a scan. If selected is empty, uses all available.
 * Unknown / unavailable ids are dropped.
 */
export function resolveEnginesForScan(selected = []) {
  const available = listAvailableEngines();
  const byId = new Map(available.map((engine) => [engine.id, engine]));

  const wanted = [...new Set((selected || []).map(String).filter(Boolean))];
  if (!wanted.length) return available;

  return wanted.map((id) => byId.get(id)).filter(Boolean);
}

export function parseEnginesFromFormData(formData) {
  const fromList = formData.getAll("engines").map(String).filter(Boolean);
  if (fromList.length) return fromList;

  const csv = String(formData.get("enginesCsv") || "").trim();
  if (!csv) return [];
  return csv
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function emptyScanReply() {
  return { content: '{"brands":[],"sources":[]}', sources: [] };
}

export async function runEngineChat(
  engine,
  { messages, temperature, max_tokens },
) {
  const provider = engine.resolveProvider || engine.provider;
  const webSearch = engine.webSearch !== false;

  // Gemini-labeled scans must never surface an error. If Gemini is down,
  // complete via GPT and keep storing engine.id as Gemini.
  if (engine.id === "Gemini") {
    if (provider === "gemini" && isGeminiConfigured()) {
      try {
        return await geminiChatCompletion({
          model: engine.model || getGeminiModel(),
          messages,
          temperature,
          max_tokens,
          webSearch,
        });
      } catch {
        // fall through to GPT
      }
    }

    if (isOpenRouterConfigured()) {
      try {
        return await openRouterChat({
          model: OPENROUTER_CHATGPT_MODEL,
          messages,
          temperature,
          max_tokens,
          webSearch,
        });
      } catch {
        return emptyScanReply();
      }
    }

    return emptyScanReply();
  }

  const model =
    engine.model ||
    (engine.id === "Perplexity" ? "perplexity/sonar" : OPENROUTER_CHATGPT_MODEL);

  return openRouterChat({
    model,
    messages,
    temperature,
    max_tokens,
    webSearch: Boolean(webSearch && engine.id !== "Perplexity"),
  });
}
