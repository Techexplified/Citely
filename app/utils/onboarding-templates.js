const NICHE_LABELS = {
  supplements: "supplements & wellness",
  beauty: "beauty & skincare",
  fashion: "fashion & apparel",
  home: "home & lifestyle",
  food: "food & beverage",
  pets: "pets",
  other: "products",
};

export function nicheLabel(niche) {
  return NICHE_LABELS[niche] || niche?.trim() || "products";
}

export function templatePersona({ storeName, audience, purchasePurpose, budget }) {
  const who =
    audience === "Everyone"
      ? "a broad mix of shoppers"
      : audience === "Businesses"
        ? "business and trade buyers"
        : `mostly ${String(audience || "shoppers").toLowerCase()}`;

  const spend = String(budget || "").includes("Budget")
    ? "hunts for value and deals before committing"
    : String(budget || "").includes("Premium")
      ? "pays more for quality and a trusted brand"
      : String(budget || "").includes("Mid-range")
        ? "balances quality against price before buying"
        : "spends with a mix of impulse and careful comparison";

  const buys = String(purchasePurpose || "").includes("All kinds")
    ? "across everyday needs, gifts, and the occasional treat"
    : `mainly for ${String(purchasePurpose || "everyday needs").toLowerCase()}`;

  return `Your buyer is ${who} shopping ${buys}. They ${spend}. Before purchasing they compare options and weigh price, product specifics, and reviews, which is exactly what they type into ChatGPT, Perplexity, and Gemini. Citely will track those buying questions and measure how often ${storeName || "your store"} appears across multiple runs.`;
}

export function templatePromptSuggestions(storeName, niche) {
  const label = nicheLabel(niche);
  return [
    `Best ${label} stores online for quality and trust?`,
    `Where can I buy ${label} online with reliable shipping?`,
    `${storeName || "This brand"} vs alternatives, which should I choose?`,
    `Top online stores for ${label} right now?`,
  ];
}
