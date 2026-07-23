/**
 * Deep link that opens App embeds and activates the Citely theme embed block.
 * Block liquid file: extensions/citely-theme/blocks/citely-embed.liquid
 */
export function getThemeEmbedEditorUrl(shopDomain) {
  const storeHandle = String(shopDomain || "").replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const blockHandle = "citely-embed";
  const activate = apiKey
    ? `&activateAppId=${encodeURIComponent(`${apiKey}/${blockHandle}`)}`
    : "";

  return `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps${activate}`;
}
