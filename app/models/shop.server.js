import prisma from "../db.server";

export async function getShopByDomain(shopDomain) {
  return prisma.shop.findUnique({ where: { shopDomain } });
}

export async function upsertShopProfile(shopDomain, data) {
  return prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain, ...data },
    update: data,
  });
}

export async function ensureShop(shopDomain, defaults = {}) {
  const existing = await getShopByDomain(shopDomain);
  if (existing) return existing;

  try {
    return await prisma.shop.create({
      data: {
        shopDomain,
        ...defaults,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const raced = await getShopByDomain(shopDomain);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function ensurePrimaryPrompt(shop) {
  if (!shop?.id) return null;

  const existing = await prisma.trackedPrompt.findFirst({
    where: { shopId: shop.id, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const text = shop.primaryPrompt?.trim();
  if (!text) return null;

  return prisma.trackedPrompt.create({
    data: {
      shopId: shop.id,
      text,
      source: "onboarding",
      active: true,
    },
  });
}
