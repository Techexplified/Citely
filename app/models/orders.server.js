import prisma from "../db.server";

export async function upsertAiOrder(shopId, data) {
  return prisma.aiOrder.upsert({
    where: {
      shopId_orderId: {
        shopId,
        orderId: String(data.orderId),
      },
    },
    create: {
      shopId,
      orderId: String(data.orderId),
      engine: data.engine || null,
      productTitle: data.productTitle || null,
      value: Number(data.value) || 0,
      orderedAt: data.orderedAt ? new Date(data.orderedAt) : new Date(),
    },
    update: {
      engine: data.engine || null,
      productTitle: data.productTitle || null,
      value: Number(data.value) || 0,
      orderedAt: data.orderedAt ? new Date(data.orderedAt) : undefined,
    },
  });
}

export async function recordAiOrderFromShopify(shopId, order) {
  const attrs = order?.note_attributes || order?.noteAttributes || [];
  const attrMap = Object.fromEntries(
    (Array.isArray(attrs) ? attrs : []).map((row) => [
      String(row?.name || row?.key || "").toLowerCase(),
      String(row?.value || ""),
    ]),
  );

  const engine =
    attrMap.citely_ai_engine ||
    attrMap["citely_ai_engine"] ||
    null;
  const attributed =
    String(attrMap.citely_ai_attributed || "").toLowerCase() === "true" ||
    Boolean(engine);

  if (!attributed) return null;

  const line = order?.line_items?.[0] || order?.lineItems?.[0];
  const value = Number(order?.total_price ?? order?.totalPrice ?? 0);

  return upsertAiOrder(shopId, {
    orderId: order?.id || order?.admin_graphql_api_id || crypto.randomUUID(),
    engine,
    productTitle: line?.title || line?.name || null,
    value,
    orderedAt: order?.created_at || order?.createdAt || new Date(),
  });
}

export async function listAiOrders(shopId, { take = 50 } = {}) {
  return prisma.aiOrder.findMany({
    where: { shopId },
    orderBy: { orderedAt: "desc" },
    take,
  });
}

export async function getAiOrderStats(shopId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const orders = await prisma.aiOrder.findMany({
    where: { shopId, orderedAt: { gte: startOfMonth } },
    orderBy: { orderedAt: "desc" },
  });

  const revenue = orders.reduce((sum, row) => sum + (row.value || 0), 0);
  const count = orders.length;
  const aov = count ? revenue / count : 0;

  const byEngine = {};
  for (const order of orders) {
    const key = order.engine || "Unknown";
    if (!byEngine[key]) byEngine[key] = { engine: key, revenue: 0, orders: 0 };
    byEngine[key].revenue += order.value || 0;
    byEngine[key].orders += 1;
  }

  const byProduct = {};
  for (const order of orders) {
    const key = order.productTitle || "Unknown product";
    if (!byProduct[key]) {
      byProduct[key] = { productTitle: key, revenue: 0, orders: 0 };
    }
    byProduct[key].revenue += order.value || 0;
    byProduct[key].orders += 1;
  }

  return {
    revenue,
    count,
    aov,
    orders,
    byEngine: Object.values(byEngine).sort((a, b) => b.revenue - a.revenue),
    byProduct: Object.values(byProduct)
      .map((row) => ({
        ...row,
        aov: row.orders ? row.revenue / row.orders : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}
