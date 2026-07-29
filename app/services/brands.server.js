const JUNK_BRANDS = new Set(
  [
    "amazon",
    "walmart",
    "target",
    "ebay",
    "etsy",
    "google",
    "bing",
    "yahoo",
    "wikipedia",
    "reddit",
    "quora",
    "youtube",
    "facebook",
    "instagram",
    "tiktok",
    "webmd",
    "healthline",
    "forbes",
    "nytimes",
    "cnn",
    "bbc",
    "wirecutter",
    "consumer reports",
    "shopify",
    "chatgpt",
    "gemini",
    "perplexity",
    "openai",
    "claude",
    "none",
    "n/a",
    "unknown",
    "various",
    "others",
    "other",
  ].map((v) => v.toLowerCase()),
);

export function normalizeBrand(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function looksLikeUrl(value = "") {
  const text = String(value).trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^www\./i.test(text)) return true;
  if (/\.(com|net|org|io|co|ai|shop|store|info|biz)(\/|$|\?)/i.test(text)) {
    return true;
  }
  if (text.includes("/") && /\.[a-z]{2,}/i.test(text)) return true;
  return false;
}

export function isPlaceholderBrand(name = "") {
  const value = String(name).trim();
  if (!value) return true;
  return /^(brand|store|example|company|retailer|competitor|product)\s*[a-z0-9_-]*$/i.test(
    value,
  );
}

export function looksLikeJsonDebris(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^[{[]/.test(text)) return true;
  if (/[}\]]$/.test(text)) return true;
  if (/"\s*:\s*"/.test(text)) return true;
  if (/\b(brands|sources|name|title|url)\s*"?\s*:/i.test(text)) return true;
  if (text.includes('{"') || text.includes('["') || text.includes('"}')) return true;
  return false;
}

/**
 * Pull a usable brand out of messy LLM / JSON debris when possible.
 */
export function sanitizeBrandCandidate(raw = "") {
  let value = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";

  // {"name":"Vitacost"  or  "name":"iHerb"
  const named = value.match(/"name"\s*:\s*"([^"]{2,48})"/i);
  if (named?.[1]) value = named[1].trim();

  // strip leftover JSON punctuation
  value = value
    .replace(/^[\s{[\"]+/, "")
    .replace(/[\s}\]",]+$/, "")
    .replace(/^name"\s*:\s*"/i, "")
    .replace(/^brands"\s*:\s*\[\s*\{\s*"name"\s*:\s*"/i, "")
    .replace(/[|·•].*$/, "")
    .replace(/^[\d\-*.)\s]+/, "")
    .trim();

  if (looksLikeJsonDebris(value)) return "";
  return value;
}

export function isJunkBrand(name = "") {
  const value = String(name || "").trim();
  if (!value) return true;
  if (looksLikeJsonDebris(value)) return true;
  if (isPlaceholderBrand(value)) return true;
  if (looksLikeUrl(value)) return true;
  if (value.length < 2 || value.length > 48) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^[\W_]+$/.test(value)) return true;
  if (/[{}\[\]"]/.test(value)) return true;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 4) return true;

  // API / model error text leaking in as brands
  if (
    /\b(quota|rate limit|exceeded|api key|unauthorized|forbidden|timeout|timed out|internal error|bad request)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (/^(you|we|error|failed|sorry)\b/i.test(value)) return true;

  // Article / listicle titles leaking in as brands
  if (
    /^(best|top|how|what|why|where|when|who|guide|review|reviews|vs)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (/\b(202[0-9]|roundup|compared|alternatives?)\b/i.test(value)) return true;

  const normalized = normalizeBrand(value);
  if (!normalized) return true;
  if (JUNK_BRANDS.has(normalized)) return true;

  // Domains without protocol: "iherb.com"
  if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(value)) return true;

  return false;
}

export function cleanBrandNames(names = [], options = {}) {
  const exclude = new Set(
    (options.exclude || []).map(normalizeBrand).filter(Boolean),
  );
  const out = [];
  const seen = new Set();

  for (const raw of names) {
    const name = sanitizeBrandCandidate(raw);
    if (!name || isJunkBrand(name)) continue;

    const key = normalizeBrand(name);
    if (!key || seen.has(key)) continue;
    if (exclude.has(key)) continue;

    seen.add(key);
    out.push(name);
    if (out.length >= 10) break;
  }

  return out;
}

export function brandsMatch(a, b) {
  const left = normalizeBrand(a);
  const right = normalizeBrand(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // Avoid ultra short substring false positives
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}

export function mentionedInList(brands, matchers) {
  return brands.some((brand) =>
    matchers.some((matcher) => brandsMatch(brand, matcher)),
  );
}

export function rankOfStore(brands, matchers) {
  const index = brands.findIndex((brand) =>
    matchers.some((matcher) => brandsMatch(brand, matcher)),
  );
  return index >= 0 ? index + 1 : null;
}

export function firstRival(brands, matchers) {
  return (
    brands.find(
      (brand) => !matchers.some((matcher) => brandsMatch(brand, matcher)),
    ) || null
  );
}

export function storeMatchers(shop) {
  const values = [
    shop?.storeName,
    shop?.shopDomain?.replace(".myshopify.com", ""),
    shop?.shopDomain,
  ]
    .filter(Boolean)
    .map(normalizeBrand)
    .filter(Boolean);

  return [...new Set(values)];
}

export function parseExcerpt(rawExcerpt = "") {
  const text = String(rawExcerpt || "").trim();
  if (!text) {
    return { brands: [], sources: [], error: null };
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const brands = cleanBrandNames(parsed.brands || []);
      const sources = normalizeSources(parsed.sources || []);
      return {
        brands,
        sources,
        error: parsed.error ? String(parsed.error) : null,
      };
    }
  } catch {
    // legacy format
  }

  const [brandPart, ...rest] = text.split("||");
  const brands = cleanBrandNames(
    (brandPart || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const sources = normalizeSources(
    rest
      .join("||")
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean),
  );

  return { brands, sources, error: null };
}

export function formatExcerpt(brands, sources, error = null) {
  return JSON.stringify({
    brands: (brands || []).slice(0, 8),
    sources: normalizeSources(sources).slice(0, 8),
    error: error || null,
  }).slice(0, 1800);
}

export function normalizeSources(list = []) {
  const map = new Map();

  for (const item of list || []) {
    let url = "";
    let title = null;

    if (typeof item === "string") {
      const value = item.trim();
      if (!value) continue;
      if (looksLikeUrl(value) || /^https?:\/\//i.test(value)) {
        url = value.startsWith("http") ? value : `https://${value}`;
      } else {
        title = value;
      }
    } else if (item && typeof item === "object") {
      url = String(item.url || item.uri || item.link || "").trim();
      title = String(item.title || item.name || "").trim() || null;
    }

    if (!url && !title) continue;

    const key = url || `title:${title}`;
    if (map.has(key)) continue;
    map.set(key, { url: url || null, title });
  }

  return [...map.values()].slice(0, 8);
}

export function sourceLabel(source) {
  if (!source) return "";
  if (source.title) return source.title;
  if (!source.url) return "";
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.url;
  }
}

function toName(item) {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    return String(item.name || item.brand || item.store || "").trim();
  }
  return "";
}

function toSource(item) {
  if (typeof item === "string") {
    const value = item.trim();
    if (!value) return null;
    if (looksLikeUrl(value) || /^https?:\/\//i.test(value)) {
      return {
        url: value.startsWith("http") ? value : `https://${value}`,
        title: null,
      };
    }
    return { url: null, title: value };
  }
  if (item && typeof item === "object") {
    const url = String(item.url || item.uri || item.link || "").trim();
    const title = String(item.title || item.name || "").trim() || null;
    if (!url && !title) return null;
    return {
      url: url || null,
      title: title && title !== url ? title : null,
    };
  }
  return null;
}

/**
 * Parse LLM JSON (or messy text) into clean brands + sources.
 */
export function parseBrandListFromContent(content) {
  const cleaned = String(content || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const fromParsed = (parsed) => {
    if (Array.isArray(parsed)) {
      return {
        brands: parsed.map(toName).filter(Boolean),
        sources: [],
      };
    }
    if (!parsed || typeof parsed !== "object") return null;

    const list =
      parsed.brands ||
      parsed.stores ||
      parsed.recommendations ||
      parsed.competitors ||
      parsed.names ||
      parsed.response;

    let brands = [];
    if (Array.isArray(list)) brands = list.map(toName).filter(Boolean);
    else if (typeof list === "string") {
      brands = list
        .split(/[\n,;]/)
        .map((part) => part.replace(/^[\d\-*.)\s]+/, "").trim())
        .filter((part) => part.length > 1 && part.length < 80)
        .slice(0, 12);
    }

    const sourceBag = new Map();
    const pushSource = (item) => {
      const source = toSource(item);
      if (!source) return;
      const key = source.url || `title:${source.title}`;
      if (!key || sourceBag.has(key)) return;
      // Never treat a brand name field as a source URL
      if (source.url && isJunkBrand(source.url) && !looksLikeUrl(source.url)) {
        return;
      }
      sourceBag.set(key, source);
    };

    if (Array.isArray(parsed.sources)) parsed.sources.forEach(pushSource);
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object") {
          if (Array.isArray(item.sources)) item.sources.forEach(pushSource);
          if (item.source) pushSource(item.source);
          if (item.url) pushSource(item);
        }
      }
    }

    // Pull bare URLs out of leftover text that wrongly landed in brand slots
    brands = brands.filter((name) => {
      if (looksLikeUrl(name)) {
        pushSource(name);
        return false;
      }
      return true;
    });

    if (!brands.length && !sourceBag.size) return null;
    return { brands, sources: [...sourceBag.values()] };
  };

  try {
    const direct = fromParsed(JSON.parse(cleaned));
    if (direct) {
      return {
        brands: cleanBrandNames(direct.brands),
        sources: normalizeSources(direct.sources),
      };
    }
  } catch {
    // try embedded JSON next
  }

  const embedded = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (embedded) {
    try {
      const nested = fromParsed(JSON.parse(embedded[0]));
      if (nested) {
        return {
          brands: cleanBrandNames(nested.brands),
          sources: normalizeSources(nested.sources),
        };
      }
    } catch {
      // fall through
    }
  }

  // Last resort: only keep tokens that look like brand names, never URLs
  const loose = cleaned
    .split(/[\n,]/)
    .map((part) => part.replace(/^[\d\-*.)\s]+/, "").trim())
    .filter((part) => part.length > 1 && part.length < 48 && !looksLikeUrl(part));

  return {
    brands: cleanBrandNames(loose),
    sources: [],
  };
}
