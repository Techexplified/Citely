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

/** Delete all app data for a shop (shop/redact). Cascades related rows. */
export async function deleteShopData(shopDomain) {
  if (!shopDomain) return { shop: 0, sessions: 0 };

  const [shopResult, sessionsResult] = await prisma.$transaction([
    prisma.shop.deleteMany({ where: { shopDomain } }),
    prisma.session.deleteMany({ where: { shop: shopDomain } }),
  ]);

  return { shop: shopResult.count, sessions: sessionsResult.count };
}

/**
 * Remove stored order attribution rows for a customer redaction request.
 * Citely does not store customer PII; AiOrder rows are keyed by Shopify order id.
 */
export async function redactCustomerOrderData(shopDomain, orderIds = []) {
  if (!shopDomain) return { deleted: 0 };

  const shop = await getShopByDomain(shopDomain);
  if (!shop) return { deleted: 0 };

  const ids = (Array.isArray(orderIds) ? orderIds : [])
    .map((id) => String(id))
    .filter(Boolean);

  if (ids.length === 0) return { deleted: 0 };

  const result = await prisma.aiOrder.deleteMany({
    where: {
      shopId: shop.id,
      orderId: { in: ids },
    },
  });

  return { deleted: result.count };
}

/** Collect any stored order attribution data for a customers/data_request. */
export async function getCustomerOrderData(shopDomain, orderIds = []) {
  if (!shopDomain) return [];

  const shop = await getShopByDomain(shopDomain);
  if (!shop) return [];

  const ids = (Array.isArray(orderIds) ? orderIds : [])
    .map((id) => String(id))
    .filter(Boolean);

  if (ids.length === 0) return [];

  return prisma.aiOrder.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: ids },
    },
  });
}
