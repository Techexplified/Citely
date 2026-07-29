import prisma from "../db.server";
import { upsertCompetitorNames } from "../models/competitor.server";
import { ensureBaselineFixes } from "../models/fixes.server";
import { listActivePrompts } from "../models/prompt.server";
import {
  cleanBrandNames,
  firstRival,
  formatExcerpt,
  mentionedInList,
  normalizeSources,
  parseBrandListFromContent,
  parseExcerpt,
  rankOfStore,
  storeMatchers,
} from "./brands.server";
import {
  isAnyScanEngineConfigured,
  resolveEnginesForScan,
  runEngineChat,
} from "./engines.server";

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

const STALE_SCAN_MS = 12 * 60 * 1000;

export function getScanProgress(job) {
  if (!job) return null;

  if (job.status === "running") {
    const started = new Date(job.startedAt || job.createdAt).getTime();
    if (Number.isFinite(started) && Date.now() - started > STALE_SCAN_MS) {
      return {
        status: "error",
        error: "Previous scan timed out or was interrupted. Run a new scan.",
        finishedAt: job.finishedAt,
      };
    }

    try {
      const meta = JSON.parse(job.error || "{}");
      if (meta?.phase === "running") {
        return {
          status: "running",
          completed: meta.completed || 0,
          total: meta.total || 0,
          engines: meta.engines || [],
          currentEngine: meta.currentEngine || null,
          currentPrompt: meta.currentPrompt || null,
        };
      }
    } catch {
      // plain error string while unexpectedly running
    }

    return { status: "running", completed: 0, total: 0, engines: [] };
  }

  return {
    status: job.status,
    error: job.status === "error" ? job.error : null,
    finishedAt: job.finishedAt,
  };
}

export async function getScanStats(shopId) {
  // Heal zombie "running" jobs left by timed-out requests
  const staleBefore = new Date(Date.now() - STALE_SCAN_MS);
  await prisma.scanJob.updateMany({
    where: {
      shopId,
      status: "running",
      startedAt: { lt: staleBefore },
    },
    data: {
      status: "error",
      finishedAt: new Date(),
      error: "Scan timed out or was interrupted. Run a new scan.",
    },
  });

  const latest = await getLatestDoneScan(shopId);
  const latestJob = await getLatestScanJob(shopId);
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

  const sourceMap = new Map();
  for (const mention of latestMentions) {
    const parsed = parseExcerpt(mention.rawExcerpt);
    for (const source of parsed.sources) {
      const key = source.url || source.title;
      if (!key || sourceMap.has(key)) continue;
      sourceMap.set(key, source);
    }
  }

  return {
    latest,
    latestJob,
    progress: getScanProgress(latestJob),
    lastScanAt: latest?.finishedAt || latest?.createdAt || null,
    mentionRate,
    recentRunCount: recentJobs.length,
    promptsTracked,
    promptsMentioned: mentionedPromptIds.size,
    promptsMissing: Math.max(promptsTracked - mentionedPromptIds.size, 0),
    engines,
    mentions: latestMentions,
    topSources: [...sourceMap.values()].slice(0, 40),
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

  await prisma.scanJob.updateMany({
    where: { shopId: shop.id, status: "running" },
    data: {
      status: "error",
      finishedAt: new Date(),
      error: "Scan interrupted before completion.",
    },
  });

  const totalSteps = prompts.length * engines.length;
  const job = await prisma.scanJob.create({
    data: {
      shopId: shop.id,
      status: "running",
      startedAt: new Date(),
      error: JSON.stringify({
        phase: "running",
        completed: 0,
        total: totalSteps,
        engines: engines.map((e) => e.id),
      }),
    },
  });

  const matchers = storeMatchers(shop);
  const rivalNames = [];
  const missingPromptTexts = [];

  try {
    let completedMentions = 0;
    let completedSteps = 0;

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
                    'You recommend real consumer brands and stores for shoppers. Use web search when available. Reply with JSON only: {"brands":[{"name":"iHerb","sources":[{"url":"https://example.com/review","title":"Review"}]}],"sources":[{"url":"https://example.com/roundup","title":"Roundup"}]}. Rules: brand names only (short proper nouns). Never return URLs, domains, publishers, media sites, or placeholders like Brand A. Include the source pages that support each recommendation.',
                },
                {
                  role: "user",
                  content: `Buyer question: ${prompt.text}\nNiche: ${shop.niche || "general ecommerce"}\nStore to check for (do not invent it if missing): ${shop.storeName || shop.shopDomain}\nReturn up to 8 real competing brand or store names (strongest first) with source URLs.`,
                },
              ],
            });
          const parsed = parseBrandListFromContent(content);
          brands = cleanBrandNames(parsed.brands);
          sources = normalizeSources([
            ...(parsed.sources || []),
            ...(groundingSources || []),
          ]);
        } catch (error) {
          engineError = error?.message || "Engine request failed";
          console.error(
            `Scan engine failed (${engine.id}/${engine.model}):`,
            engineError,
          );
        }

        const mentioned = mentionedInList(brands, matchers);
        if (mentioned) promptMentioned = true;

        const rivals = brands.filter(
          (brand) => !mentionedInList([brand], matchers),
        );
        const rival = firstRival(brands, matchers);
        for (const brand of rivals) rivalNames.push(brand);

        await prisma.scanMention.create({
          data: {
            scanJobId: job.id,
            promptId: prompt.id,
            engine: engine.id,
            mentioned,
            rank: rankOfStore(brands, matchers),
            rivalCited: rival,
            rawExcerpt: formatExcerpt(brands, sources, engineError),
          },
        });

        completedSteps += 1;
        if (!engineError) completedMentions += 1;

        await prisma.scanJob.update({
          where: { id: job.id },
          data: {
            error: JSON.stringify({
              phase: "running",
              completed: completedSteps,
              total: totalSteps,
              engines: engines.map((e) => e.id),
              currentEngine: engine.id,
              currentPrompt: prompt.text.slice(0, 80),
            }),
          },
        });
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

    return {
      ok: true,
      job: done,
      message: `Scan complete. Checked ${prompts.length} question${prompts.length === 1 ? "" : "s"} across ${engines.length} engine${engines.length === 1 ? "" : "s"}.`,
    };
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
