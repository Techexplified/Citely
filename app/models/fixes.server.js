import prisma from "../db.server";

const IMPACT_ORDER = { high: 0, med: 1, low: 2 };

export async function listFixes(shopId) {
  const fixes = await prisma.fixItem.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
  });

  return fixes.sort(
    (a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9),
  );
}

export async function upsertFix(shopId, data) {
  return prisma.fixItem.upsert({
    where: { shopId_key: { shopId, key: data.key } },
    create: { shopId, ...data },
    update: {
      title: data.title,
      impact: data.impact,
      meta: data.meta,
      ...(data.status ? { status: data.status } : {}),
    },
  });
}

export async function setFixStatus(shopId, fixId, status) {
  return prisma.fixItem.updateMany({
    where: { id: fixId, shopId },
    data: { status },
  });
}

export async function ensureBaselineFixes(shop, missingPromptTexts = []) {
  const themeStatus = shop.themeEmbedActive ? "todo" : "needs_embed";

  await upsertFix(shop.id, {
    key: "llms_txt",
    title: "Publish an AI guide for your store",
    impact: "high",
    status: "todo",
    meta: {
      description:
        "Give AI a clear map of your brand, products, and policies so engines can cite you accurately.",
    },
  });

  await upsertFix(shop.id, {
    key: "product_faq_schema",
    title: "Add Product + FAQ details for AI",
    impact: "med",
    status: themeStatus,
    meta: {
      description:
        "Clear product and FAQ details help AI cite accurate info. Turn on the Citely theme embed first.",
      needsEmbed: true,
    },
  });

  await upsertFix(shop.id, {
    key: "description_depth",
    title: "Add dosage, testing, and proof detail to descriptions",
    impact: "med",
    status: "todo",
    meta: {
      description:
        "Buyer questions often ask for specifics. Richer PDP copy improves mention quality in your niche.",
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
      title: `Win the buyer question: ${text}`,
      impact: "high",
      status: "todo",
      meta: {
        description:
          "Create a clear buyer guide or FAQ that answers this question with compliant, niche-accurate detail.",
        promptText: text,
      },
    });
  }
}
