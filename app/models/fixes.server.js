import prisma from "../db.server";

const IMPACT_ORDER = { high: 0, med: 1, low: 2 };

const OBSOLETE_FIX_KEYS = [
  "llms_txt",
  "product_faq_schema",
  "description_depth",
];

function nicheLabel(shop) {
  return shop.niche?.trim() || "your niche";
}

function storeLabel(shop) {
  return shop.storeName?.trim() || "your store";
}

function postTargetsFor(format, niche) {
  if (format === "reddit") {
    return [
      {
        name: `Reddit communities for ${niche}`,
        why: "Search Reddit for buyer threads in your niche and reply helpfully, or start a discussion post.",
      },
      {
        name: "r/BuyItForLife, r/ProductReviews, or niche recs subs",
        why: "Recommendation threads are what AI engines often summarize.",
      },
      {
        name: "Relevant Facebook / Discord groups",
        why: "Same draft can be shortened for community Q&A — soft mention only.",
      },
    ];
  }

  return [
    {
      name: "Your blog or Shopify blog",
      why: "Own the URL. Publish, then link it from your homepage or footer.",
    },
    {
      name: "Medium / LinkedIn / Substack",
      why: "Indexed sources AI assistants frequently cite for buyer questions.",
    },
    {
      name: `Niche directories and review sites for ${niche}`,
      why: "Third-party mentions teach AI others recommend you — not only your storefront.",
    },
  ];
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

  // Never clobber a completed item back to todo on re-seed
  const nextStatus = existing.status === "applied" ? "applied" : existing.status;

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
        // Keep prior generated draft if present
        generatedContent:
          prevMeta.generatedContent || data.meta?.generatedContent || null,
        generatedAt: prevMeta.generatedAt || data.meta?.generatedAt || null,
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
 * Seed content opportunities from scan gaps + shop profile.
 * Merchants generate drafts and post themselves — no Shopify writes.
 */
export async function ensureBaselineFixes(shop, missingPromptTexts = []) {
  const niche = nicheLabel(shop);
  const store = storeLabel(shop);

  await prisma.fixItem.deleteMany({
    where: { shopId: shop.id, key: { in: OBSOLETE_FIX_KEYS } },
  });

  await upsertFix(shop.id, {
    key: "brand_article",
    title: `Write a brand guide article for ${store}`,
    impact: "high",
    status: "todo",
    meta: {
      kind: "brand_article",
      format: "article",
      description: `Generate a clear article AI engines can cite about ${store}: what you sell, who it’s for, and when to recommend you. You post it yourself.`,
      steps: [
        "Click Generate draft to create the article.",
        "Edit claims so they match your real products and policies.",
        "Publish on your blog, Medium, or LinkedIn (see Where to post).",
        "Re-run a Visibility scan after it’s live for a few days.",
      ],
      postTargets: postTargetsFor("article", niche),
      applyLabel: "Generate draft",
    },
  });

  await upsertFix(shop.id, {
    key: "reddit_thread",
    title: `Draft a Reddit thread for ${niche} buyers`,
    impact: "high",
    status: "todo",
    meta: {
      kind: "reddit_thread",
      format: "reddit",
      description: `Generate a natural Reddit-style post that answers how buyers shop ${niche}. Soft brand mention — you choose the subreddit and post manually.`,
      steps: [
        "Click Generate draft for a title + post body.",
        "Find an active subreddit where people already ask for recs in your niche.",
        "Post as a helpful discussion (follow that sub’s rules — no spam).",
        "Reply to comments with honest detail; link your store only when relevant.",
      ],
      postTargets: postTargetsFor("reddit", niche),
      applyLabel: "Generate Reddit draft",
    },
  });

  await upsertFix(shop.id, {
    key: "niche_guide",
    title: `Write a ${niche} buying-guide blog post`,
    impact: "med",
    status: "todo",
    meta: {
      kind: "niche_guide",
      format: "blog",
      description: `Buyer questions in ${niche} reward concrete comparison content. Generate a guide you can publish on your blog or Medium — Citely won’t post it for you.`,
      steps: [
        "Click Generate draft to create the buying guide.",
        "Add 2–3 real product links and proof points you can support.",
        "Publish on your blog or a third-party article platform.",
        "Share the URL in one community thread or newsletter.",
      ],
      postTargets: postTargetsFor("blog", niche),
      applyLabel: "Generate blog draft",
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
      title: `Answer this buyer question with content`,
      impact: "high",
      status: "todo",
      meta: {
        kind: "gap_content",
        format: "blog",
        promptText: text,
        description: `AI named rivals for “${text}” but not ${store}. Generate a guide or thread that answers it with your niche-accurate detail — then post it where buyers (and AI) look.`,
        steps: [
          "Click Generate draft to create an answer for this question.",
          "Fact-check and add real product links before publishing.",
          "Post the article on your blog/Medium, or adapt it for Reddit.",
          "Re-run Visibility after the page has been indexed.",
        ],
        postTargets: [
          ...postTargetsFor("blog", niche),
          {
            name: "Reddit — search this exact buyer question",
            why: "If a thread already exists, a helpful comment with your guide link can earn citations faster than a new post.",
          },
        ],
        applyLabel: "Generate answer draft",
      },
    });
  }
}
