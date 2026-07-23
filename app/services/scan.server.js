import prisma from "../db.server";
import { upsertCompetitorNames } from "../models/competitor.server";
import { ensureBaselineFixes } from "../models/fixes.server";
import { listActivePrompts } from "../models/prompt.server";
import {
  chatCompletion,
  getEngineModels,
  isOpenRouterConfigured,
} from "./openrouter.server";

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

function parseBrandList(content) {
  const cleaned = String(content || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    if (Array.isArray(parsed?.brands)) {
      return parsed.brands.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // fall through to line parsing
  }

  return cleaned
    .split(/[\n,]/)
    .map((part) => part.replace(/^[\d\-*.)\s]+/, "").trim())
    .filter((part) => part.length > 1 && part.length < 80)
    .slice(0, 12);
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

export async function runShopScan(shop) {
  if (!isOpenRouterConfigured()) {
    return {
      ok: false,
      error:
        "AI scanning isn’t available right now. Try again later or contact support.",
    };
  }

  const prompts = await listActivePrompts(shop.id);
  if (!prompts.length) {
    return {
      ok: false,
      error: "Add at least one tracked buyer question before running a scan.",
    };
  }

  const engines = getEngineModels();
  const engineNames = Object.keys(engines);
  if (!engineNames.length) {
    return { ok: false, error: "AI scanning isn’t configured yet. Try again later." };
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
    for (const prompt of prompts) {
      let promptMentioned = false;

      for (const engine of engineNames) {
        const model = engines[engine];
        const { content } = await chatCompletion({
          model,
          messages: [
            {
              role: "system",
              content:
                "You recommend online brands for shoppers. Reply with JSON only: {\"brands\":[\"Brand A\",\"Brand B\"]} ordered by how strongly you would recommend them. No markdown.",
            },
            {
              role: "user",
              content: `Buyer question: ${prompt.text}\nNiche context: ${shop.niche || "general ecommerce"}\nReturn up to 8 brand or store names.`,
            },
          ],
        });

        const brands = parseBrandList(content);
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
            engine,
            mentioned,
            rank: rankOfStore(brands, matchers),
            rivalCited: rival,
            rawExcerpt: brands.slice(0, 8).join(", ").slice(0, 500),
          },
        });
      }

      if (!promptMentioned) missingPromptTexts.push(prompt.text);
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
