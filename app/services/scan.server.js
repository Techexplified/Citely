import prisma from "../db.server";
import { upsertCompetitorNames } from "../models/competitor.server";
import { ensureBaselineFixes } from "../models/fixes.server";
import { listActivePrompts } from "../models/prompt.server";
import {
  isAnyScanEngineConfigured,
  resolveEnginesForScan,
  runEngineChat,
} from "./engines.server";

function normalizeBrand(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function storeMatchers(shop) {
  const values = [
    shop.storeName,
    shop.shopDomain?.replace(".myshopify.com", ""),
    shop.shopDomain,
  ]
    .filter(Boolean)
    .map(normalizeBrand)
    .filter(Boolean);

  return [...new Set(values)];
}

function isPlaceholderBrand(name = "") {
  const value = String(name).trim();
  if (!value) return true;
  return /^(brand|store|example|company|retailer)\s*[a-z0-9_-]*$/i.test(value);
}

function cleanBrandNames(names = []) {
  return [
    ...new Set(
      names
        .map((name) => String(name || "").trim())
        .filter((name) => name && !isPlaceholderBrand(name)),
    ),
  ].slice(0, 12);
}

function parseBrandList(content) {
  const cleaned = String(content || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const toName = (item) => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") {
      return String(
        item.name || item.brand || item.store || item.title || "",
      ).trim();
    }
    return "";
  };

  const toSource = (item) => {
    if (typeof item === "string") {
      const value = item.trim();
      if (!value) return null;
      return { url: value, title: null };
    }
    if (item && typeof item === "object") {
      const url = String(item.url || item.uri || item.link || "").trim();
      if (!url) return null;
      return {
        url,
        title: String(item.title || item.name || "").trim() || null,
      };
    }
    return null;
  };

  const fromParsed = (parsed) => {
    if (Array.isArray(parsed)) {
      return {
        brands: parsed.map(toName).filter(Boolean),
        sources: [],
      };
    }
    if (!parsed || typeof parsed !== "object") return null;

    const list =
      parsed.brands ||
      parsed.stores ||
      parsed.recommendations ||
      parsed.competitors ||
      parsed.names ||
      parsed.response;

    let brands = [];
    if (Array.isArray(list)) brands = list.map(toName).filter(Boolean);
    else if (typeof list === "string") {
      brands = list
        .split(/[\n,;]/)
        .map((part) => part.replace(/^[\d\-*.)\s]+/, "").trim())
        .filter((part) => part.length > 1 && part.length < 80)
        .slice(0, 12);
    }

    const sourceBag = new Map();
    const pushSource = (item) => {
      const source = toSource(item);
      if (!source?.url || sourceBag.has(source.url)) return;
      sourceBag.set(source.url, source);
    };

    if (Array.isArray(parsed.sources)) {
      parsed.sources.forEach(pushSource);
    }
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object") {
          if (Array.isArray(item.sources)) item.sources.forEach(pushSource);
          if (item.source) pushSource(item.source);
          if (item.url) pushSource(item);
        }
      }
    }

    if (!brands.length && !sourceBag.size) return null;
    return { brands, sources: [...sourceBag.values()] };
  };

  try {
    const direct = fromParsed(JSON.parse(cleaned));
    if (direct) {
      return {
        brands: cleanBrandNames(direct.brands),
        sources: direct.sources.slice(0, 8),
      };
    }
  } catch {
    // try embedded JSON next
  }

  const embedded = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (embedded) {
    try {
      const nested = fromParsed(JSON.parse(embedded[0]));
      if (nested) {
        return {
          brands: cleanBrandNames(nested.brands),
          sources: nested.sources.slice(0, 8),
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    brands: cleanBrandNames(
      cleaned
        .split(/[\n,]/)
        .map((part) => part.replace(/^[\d\-*.)\s]+/, "").trim())
        .filter((part) => part.length > 1 && part.length < 80),
    ),
    sources: [],
  };
}

function mergeSources(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      const url = String(item?.url || item || "").trim();
      if (!url || map.has(url)) continue;
      map.set(url, {
        url,
        title: item?.title ? String(item.title).trim() : null,
      });
    }
  }
  return [...map.values()].slice(0, 8);
}

function formatExcerpt(brands, sources, fallback = "") {
  const brandPart = brands.slice(0, 8).join(", ");
  const sourcePart = sources
    .slice(0, 5)
    .map((source) => source.title || source.url)
    .filter(Boolean)
    .join(" · ");

  if (brandPart && sourcePart) {
    return `${brandPart} || ${sourcePart}`.slice(0, 500);
  }
  return (brandPart || sourcePart || fallback || "").slice(0, 500);
}

function mentionedInList(brands, matchers) {
  const normalizedBrands = brands.map(normalizeBrand);
  return matchers.some((matcher) =>
    normalizedBrands.some(
      (brand) => brand === matcher || brand.includes(matcher) || matcher.includes(brand),
    ),
  );
}

function rankOfStore(brands, matchers) {
  const index = brands.findIndex((brand) => {
    const normalized = normalizeBrand(brand);
    return matchers.some(
      (matcher) =>
        normalized === matcher ||
        normalized.includes(matcher) ||
        matcher.includes(normalized),
    );
  });
  return index >= 0 ? index + 1 : null;
}

function firstRival(brands, matchers) {
  return (
    brands.find((brand) => {
      const normalized = normalizeBrand(brand);
      return !matchers.some(
        (matcher) =>
          normalized === matcher ||
          normalized.includes(matcher) ||
          matcher.includes(normalized),
      );
    }) || null
  );
}

export async function getLatestScanJob(shopId) {
  return prisma.scanJob.findFirst({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLatestDoneScan(shopId) {
  return prisma.scanJob.findFirst({
    where: { shopId, status: "done" },
    orderBy: { createdAt: "desc" },
    include: {
      mentions: {
        include: { prompt: true },
      },
    },
  });
}

export async function getScanStats(shopId) {
  const latest = await getLatestDoneScan(shopId);
  const recentJobs = await prisma.scanJob.findMany({
    where: { shopId, status: "done" },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { mentions: true },
  });

  const allMentions = recentJobs.flatMap((job) => job.mentions);
  const mentionRate = allMentions.length
    ? allMentions.filter((m) => m.mentioned).length / allMentions.length
    : 0;

  const latestMentions = latest?.mentions || [];
  const promptsTracked = new Set(latestMentions.map((m) => m.promptId)).size;
  const mentionedPromptIds = new Set(
    latestMentions.filter((m) => m.mentioned).map((m) => m.promptId),
  );
  const engines = [...new Set(latestMentions.map((m) => m.engine))];

  return {
    latest,
    lastScanAt: latest?.finishedAt || latest?.createdAt || null,
    mentionRate,
    recentRunCount: recentJobs.length,
    promptsTracked,
    promptsMentioned: mentionedPromptIds.size,
    promptsMissing: Math.max(promptsTracked - mentionedPromptIds.size, 0),
    engines,
    mentions: latestMentions,
  };
}

export async function runShopScan(shop, options = {}) {
  if (!isAnyScanEngineConfigured()) {
    return {
      ok: false,
      error:
        "AI scanning isn’t available right now. Add OPENROUTER_API_KEY and/or GEMINI_API_KEY, then try again.",
    };
  }

  const prompts = await listActivePrompts(shop.id);
  if (!prompts.length) {
    return {
      ok: false,
      error: "Add at least one tracked buyer question before running a scan.",
    };
  }

  const engines = resolveEnginesForScan(options.engines || []);
  if (!engines.length) {
    return {
      ok: false,
      error:
        "Select at least one available AI engine (ChatGPT, Gemini, or Perplexity).",
    };
  }

  const job = await prisma.scanJob.create({
    data: {
      shopId: shop.id,
      status: "running",
      startedAt: new Date(),
    },
  });

  const matchers = storeMatchers(shop);
  const rivalNames = [];
  const missingPromptTexts = [];

  try {
    let completedMentions = 0;

    for (const prompt of prompts) {
      let promptMentioned = false;

      for (const engine of engines) {
        let brands = [];
        let sources = [];
        let engineError = null;

        try {
          const { content, sources: groundingSources = [] } =
            await runEngineChat(engine, {
              max_tokens: 400,
              messages: [
                {
                  role: "system",
                  content:
                    'You recommend real online brands and stores for shoppers. Use web search when available. Reply with JSON only: {"brands":[{"name":"iHerb","sources":["https://example.com/review"]}],"sources":["https://example.com/roundup"]}. Use actual brand or retailer names only. Never use placeholders like Brand A, Brand B, Store 1, or Example. Include source URLs that support each recommendation.',
                },
                {
                  role: "user",
                  content: `Buyer question: ${prompt.text}\nNiche context: ${shop.niche || "general ecommerce"}\nSearch the web if needed, then return up to 8 real competing brand or store names (strongest first) with source URLs.`,
                },
              ],
            });
          const parsed = parseBrandList(content);
          brands = parsed.brands;
          sources = mergeSources(parsed.sources, groundingSources);
        } catch (error) {
          engineError = error?.message || "Engine request failed";
          console.error(
            `Scan engine failed (${engine.id}/${engine.model}):`,
            engineError,
          );
        }

        const mentioned = mentionedInList(brands, matchers);
        if (mentioned) promptMentioned = true;

        const rival = firstRival(brands, matchers);
        if (rival) rivalNames.push(rival);
        for (const brand of brands) {
          if (!mentionedInList([brand], matchers)) rivalNames.push(brand);
        }

        await prisma.scanMention.create({
          data: {
            scanJobId: job.id,
            promptId: prompt.id,
            engine: engine.id,
            mentioned,
            rank: rankOfStore(brands, matchers),
            rivalCited: rival,
            rawExcerpt: formatExcerpt(brands, sources, engineError || ""),
          },
        });
        if (!engineError) completedMentions += 1;
      }

      if (!promptMentioned) missingPromptTexts.push(prompt.text);
    }

    if (!completedMentions) {
      throw new Error(
        "AI scan failed for every selected engine. Check API keys/credits and try again.",
      );
    }

    await upsertCompetitorNames(shop.id, rivalNames);
    await ensureBaselineFixes(shop, missingPromptTexts);

    const done = await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "done",
        finishedAt: new Date(),
        error: null,
      },
    });

    return { ok: true, job: done };
  } catch (error) {
    const message = error?.message || "Scan failed";
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        finishedAt: new Date(),
        error: message,
      },
    });
    return { ok: false, error: message, jobId: job.id };
  }
}
