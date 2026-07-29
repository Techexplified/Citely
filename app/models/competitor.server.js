import prisma from "../db.server";
import { cleanBrandNames, isJunkBrand } from "../services/brands.server";

export async function listCompetitors(shopId) {
  const rows = await prisma.competitor.findMany({
    where: { shopId, tracked: true },
    orderBy: { name: "asc" },
  });

  // Hide junk that may already be in the DB from earlier noisy scans
  const clean = rows.filter((row) => !isJunkBrand(row.name));

  // Soft-hide JSON debris / garbage still marked tracked
  const junk = rows.filter((row) => isJunkBrand(row.name));
  if (junk.length) {
    await prisma.competitor.updateMany({
      where: { id: { in: junk.map((row) => row.id) } },
      data: { tracked: false },
    });
  }

  return clean;
}

export async function trackCompetitor(shopId, name) {
  const cleaned = cleanBrandNames([name])[0];
  if (!cleaned) {
    throw new Error("Enter a real brand name (not a URL or article title).");
  }

  return prisma.competitor.upsert({
    where: { shopId_name: { shopId, name: cleaned } },
    create: { shopId, name: cleaned, tracked: true },
    update: { tracked: true },
  });
}

export async function upsertCompetitorNames(shopId, names = []) {
  const unique = cleanBrandNames(names);

  for (const name of unique) {
    await prisma.competitor.upsert({
      where: { shopId_name: { shopId, name } },
      create: { shopId, name, tracked: true },
      update: {},
    });
  }

  // Soft-hide historical junk so standings stay clean
  const all = await prisma.competitor.findMany({ where: { shopId } });
  const junkIds = all.filter((row) => isJunkBrand(row.name)).map((row) => row.id);
  if (junkIds.length) {
    await prisma.competitor.updateMany({
      where: { id: { in: junkIds } },
      data: { tracked: false },
    });
  }
}
