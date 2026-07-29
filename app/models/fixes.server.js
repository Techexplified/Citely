import prisma from "../db.server";

const IMPACT_ORDER = { high: 0, med: 1, low: 2 };

function nicheLabel(shop) {
  return shop.niche?.trim() || "your niche";
}

function storeLabel(shop) {
  return shop.storeName?.trim() || "your store";
}

export async function listFixes(shopId) {
  const fixes = await prisma.fixItem.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
  });

  return fixes.sort(
    (a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9),
  );
}

export async function getFixById(shopId, fixId) {
  return prisma.fixItem.findFirst({
    where: { id: fixId, shopId },
  });
}

export async function upsertFix(shopId, data) {
  const existing = await prisma.fixItem.findUnique({
    where: { shopId_key: { shopId, key: data.key } },
  });

  if (!existing) {
    return prisma.fixItem.create({
      data: { shopId, ...data },
    });
  }

  // Never clobber an applied fix back to todo on re-seed
  const nextStatus =
    existing.status === "applied"
      ? "applied"
      : data.key === "product_faq_schema"
        ? data.status
        : existing.status;

  const prevMeta =
    existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
      ? existing.meta
      : {};

  return prisma.fixItem.update({
    where: { id: existing.id },
    data: {
      title: data.title,
      impact: data.impact,
      meta: {
        ...prevMeta,
        ...(data.meta || {}),
        // Keep prior apply result if present
        applyResult: prevMeta.applyResult || data.meta?.applyResult || null,
        appliedAt: prevMeta.appliedAt || data.meta?.appliedAt || null,
      },
      status: nextStatus || existing.status,
    },
  });
}

export async function setFixStatus(shopId, fixId, status, metaPatch = null) {
  const existing = await getFixById(shopId, fixId);
  if (!existing) return { count: 0 };

  const prevMeta =
    existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
      ? existing.meta
      : {};
  const nextMeta = metaPatch ? { ...prevMeta, ...metaPatch } : prevMeta;

  return prisma.fixItem.updateMany({
    where: { id: fixId, shopId },
    data: { status, meta: nextMeta },
  });
}

/**
 * Seed actionable fixes from scan gaps + shop profile.
 * Copy is niche-aware; no supplement-only hardcoded claims.
 */
export async function ensureBaselineFixes(shop, missingPromptTexts = []) {
  const themeStatus = shop.themeEmbedActive ? "todo" : "needs_embed";
  const niche = nicheLabel(shop);
  const store = storeLabel(shop);

  await upsertFix(shop.id, {
    key: "llms_txt",
    title: `Publish an AI guide for ${store}`,
    impact: "high",
    status: "todo",
    meta: {
      kind: "llms_txt",
      description: `Create a clear page AI engines can read about ${store}: what you sell, who it’s for, policies, and how to cite you.`,
      steps: [
        "Click Apply to create a published Online Store page with your AI guide.",
        "Share or link that page from your footer so crawlers can find it.",
        "Re-run a Visibility scan after it is live.",
      ],
      applyLabel: "Publish AI guide page",
    },
  });

  await upsertFix(shop.id, {
    key: "product_faq_schema",
    title: "Turn on Product + FAQ schema in your theme",
    impact: "med",
    status: themeStatus,
    meta: {
      kind: "theme_embed",
      needsEmbed: true,
      description:
        "Citely’s theme embed adds Product JSON-LD (and FAQ JSON-LD when product FAQs exist) so AI can cite accurate product details.",
      steps: [
        "Open the theme editor and enable the Citely app embed.",
        "Confirm Product schema is on for product pages.",
        "Optional: add FAQ content on products, then mark this done.",
      ],
      applyLabel: shop.themeEmbedActive ? "Mark embed confirmed" : "Open theme editor",
    },
  });

  await upsertFix(shop.id, {
    key: "description_depth",
    title: `Add proof and specifics to top ${niche} product pages`,
    impact: "med",
    status: "todo",
    meta: {
      kind: "description_depth",
      description: `Buyer questions in ${niche} reward concrete detail. Apply appends an AI-readable “Key details” section to your top products without replacing your existing copy.`,
      steps: [
        "Click Apply to update up to 5 products with a structured details block.",
        "Review the new section on each product in admin.",
        "Re-scan Visibility to see if mention quality improves.",
      ],
      applyLabel: "Enrich top product descriptions",
    },
  });

  for (const text of missingPromptTexts.slice(0, 5)) {
    const key = `gap_${text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 48)}`;

    await upsertFix(shop.id, {
      key,
      title: `Answer this buyer question on your store`,
      impact: "high",
      status: "todo",
      meta: {
        kind: "gap_page",
        promptText: text,
        description: `AI named rivals for “${text}” but not ${store}. Publish a clear guide page that answers it with your products and niche-accurate detail.`,
        steps: [
          "Click Apply to create a draft Online Store page answering this question.",
          "Edit the draft with your real product links and claims you can support.",
          "Publish the page, then re-run a Visibility scan.",
        ],
        applyLabel: "Create buyer guide page",
      },
    });
  }
}
