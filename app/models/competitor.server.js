import prisma from "../db.server";

export async function listCompetitors(shopId) {
  return prisma.competitor.findMany({
    where: { shopId, tracked: true },
    orderBy: { name: "asc" },
  });
}

export async function trackCompetitor(shopId, name) {
  const cleaned = name.trim();
  if (!cleaned) throw new Error("Competitor name is required");

  return prisma.competitor.upsert({
    where: { shopId_name: { shopId, name: cleaned } },
    create: { shopId, name: cleaned, tracked: true },
    update: { tracked: true },
  });
}

export async function upsertCompetitorNames(shopId, names = []) {
  const unique = [
    ...new Set(names.map((n) => String(n || "").trim()).filter(Boolean)),
  ];

  for (const name of unique) {
    await prisma.competitor.upsert({
      where: { shopId_name: { shopId, name } },
      create: { shopId, name, tracked: true },
      update: {},
    });
  }
}
