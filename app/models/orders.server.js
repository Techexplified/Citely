import prisma from "../db.server";

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
