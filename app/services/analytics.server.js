import {
  cleanBrandNames,
  isJunkBrand,
  normalizeBrand,
  parseExcerpt,
  sanitizeBrandCandidate,
  storeMatchers,
} from "./brands.server";

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

    const enriched = promptMentions.map((mention) => {
      const excerpt = parseExcerpt(mention.rawExcerpt);
      return {
        ...mention,
        brands: excerpt.brands,
        sources: excerpt.sources,
        engineError: excerpt.error,
      };
    });

    const allSources = [];
    const seen = new Set();
    for (const mention of enriched) {
      for (const source of mention.sources || []) {
        const key = source.url || source.title;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allSources.push(source);
      }
    }

    return {
      prompt,
      mentions: enriched,
      mentionedCount,
      engineCount,
      status,
      sources: allSources.slice(0, 8),
    };
  });
}

export function buildCompetitorStandings(shop, mentions, competitors) {
  const brandCounts = new Map();
  const matchers = storeMatchers(shop);
  const youName = shop.storeName || "You";
  const youKey = normalizeBrand(youName) || "you";

  const bump = (name, isYou = false) => {
    if (!name) return;

    let display = isYou ? String(name).trim() : cleanBrandNames([name])[0];
    if (!display && isYou) display = youName;
    if (!display) return;
    if (!isYou && isJunkBrand(display)) return;

    const key = normalizeBrand(display) || (isYou ? youKey : "");
    if (!key) return;

    const current = brandCounts.get(key) || {
      name: display,
      mentions: 0,
      isYou: false,
    };
    current.mentions += 1;
    current.isYou = current.isYou || isYou;
    // Prefer cleaner display names over debris
    if (!isJunkBrand(display) && display.length <= current.name.length) {
      current.name = display;
    }
    brandCounts.set(key, current);
  };

  for (const mention of mentions) {
    if (mention.mentioned) bump(youName, true);

    const excerpt = parseExcerpt(mention.rawExcerpt);
    const rivals = cleanBrandNames(excerpt.brands, { exclude: matchers });
    const ranked = [];

    const rivalClean = cleanBrandNames([
      sanitizeBrandCandidate(mention.rivalCited || ""),
    ])[0];
    if (rivalClean) ranked.push(rivalClean);

    for (const brand of rivals) {
      if (ranked.some((r) => normalizeBrand(r) === normalizeBrand(brand))) {
        continue;
      }
      ranked.push(brand);
    }

    // Weight rank position: #1 counts more than #2/#3
    ranked.slice(0, 3).forEach((brand, index) => {
      const weight = index === 0 ? 3 : index === 1 ? 2 : 1;
      for (let i = 0; i < weight; i += 1) bump(brand, false);
    });
  }

  // Tracked competitors with no scan hits stay at 0% (not equal-share padding)
  for (const competitor of competitors) {
    const cleaned = cleanBrandNames([competitor.name])[0];
    if (!cleaned) continue;
    const key = normalizeBrand(cleaned);
    if (!key || brandCounts.has(key)) continue;
    brandCounts.set(key, {
      name: cleaned,
      mentions: 0,
      isYou: false,
    });
  }

  if (shop.storeName && !brandCounts.has(youKey)) {
    brandCounts.set(youKey, {
      name: shop.storeName,
      mentions: 0,
      isYou: true,
    });
  }

  const scored = [...brandCounts.values()].filter(
    (row) => row.isYou || row.mentions > 0,
  );
  const total = scored.reduce((sum, row) => sum + row.mentions, 0);

  const standings = scored
    .map((row) => ({
      ...row,
      share: total ? Math.round((row.mentions / total) * 100) : 0,
    }))
    .sort((a, b) => b.share - a.share || b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, 12);

  const yourIndex = standings.findIndex((row) => row.isYou);
  const leader = standings.find((row) => !row.isYou) || standings[0] || null;
  const you = yourIndex >= 0 ? standings[yourIndex] : null;

  return {
    standings,
    yourRank: yourIndex >= 0 ? yourIndex + 1 : null,
    totalBrands: standings.length,
    yourShare: you?.share || 0,
    gapToLeader:
      leader && you && !leader.isYou ? Math.max(leader.share - you.share, 0) : 0,
  };
}
