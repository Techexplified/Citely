import prisma from "../db.server";

export async function listActivePrompts(shopId) {
  return prisma.trackedPrompt.findMany({
    where: { shopId, active: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listAllPrompts(shopId) {
  return prisma.trackedPrompt.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
  });
}

export async function addPrompt(shopId, text, source = "manual") {
  const cleaned = text.trim();
  if (!cleaned) throw new Error("Prompt text is required");

  return prisma.trackedPrompt.create({
    data: { shopId, text: cleaned, source, active: true },
  });
}

export async function deactivatePrompt(shopId, promptId) {
  return prisma.trackedPrompt.updateMany({
    where: { id: promptId, shopId },
    data: { active: false },
  });
}
