import { getScanStats } from "../services/scan.server";

export function buildVisibilityRows(prompts, mentions) {
  return prompts.map((prompt) => {
    const promptMentions = mentions.filter((m) => m.promptId === prompt.id);
    const mentionedCount = promptMentions.filter((m) => m.mentioned).length;
    const engineCount = promptMentions.length;
    const status =
      engineCount === 0
        ? "unscanned"
        : mentionedCount === 0
          ? "missing"
          : mentionedCount === engineCount
            ? "mentioned"
            : "partial";

    return {
      prompt,
      mentions: promptMentions,
      mentionedCount,
      engineCount,
      status,
    };
  });
}

export function buildCompetitorStandings(shop, mentions, competitors) {
  const brandCounts = new Map();

  const bump = (name, isYou = false) => {
    if (!name) return;
    const key = name.trim();
    if (!key) return;
    const current = brandCounts.get(key) || {
      name: key,
      mentions: 0,
      isYou,
    };
    current.mentions += 1;
    current.isYou = current.isYou || isYou;
    brandCounts.set(key, current);
  };

  for (const mention of mentions) {
    if (mention.mentioned) bump(shop.storeName || "You", true);
    if (mention.rivalCited) bump(mention.rivalCited, false);
    if (mention.rawExcerpt) {
      const brandPart = String(mention.rawExcerpt).split("||")[0] || "";
      brandPart.split(",").forEach((part) => {
        const name = part.trim();
        if (!name) return;
        const isYou =
          shop.storeName &&
          name.toLowerCase().includes(String(shop.storeName).toLowerCase());
        bump(name, Boolean(isYou));
      });
    }
  }

  for (const competitor of competitors) {
    if (!brandCounts.has(competitor.name)) {
      brandCounts.set(competitor.name, {
        name: competitor.name,
        mentions: 0,
        isYou: false,
      });
    }
  }

  if (shop.storeName && !brandCounts.has(shop.storeName)) {
    brandCounts.set(shop.storeName, {
      name: shop.storeName,
      mentions: 0,
      isYou: true,
    });
  }

  const total = [...brandCounts.values()].reduce(
    (sum, row) => sum + row.mentions,
    0,
  );

  const standings = [...brandCounts.values()]
    .map((row) => ({
      ...row,
      share: total ? Math.round((row.mentions / total) * 100) : 0,
    }))
    .sort((a, b) => b.share - a.share || b.mentions - a.mentions);

  const yourIndex = standings.findIndex((row) => row.isYou);
  const leader = standings[0] || null;
  const you = yourIndex >= 0 ? standings[yourIndex] : null;

  return {
    standings,
    yourRank: yourIndex >= 0 ? yourIndex + 1 : null,
    totalBrands: standings.length,
    yourShare: you?.share || 0,
    gapToLeader:
      leader && you && !leader.isYou ? leader.share - you.share : 0,
  };
}

export async function getDashboardBundle(shop) {
  const stats = await getScanStats(shop.id);
  return stats;
}
