import { authenticate } from "../shopify.server";
import { deleteShopData } from "../models/shop.server";
import {
  handleWebhookAction,
  shopFromWebhookRequest,
} from "../utils/webhook.server";

export const action = async ({ request }) => {
  const fallbackShop = shopFromWebhookRequest(request);

  return handleWebhookAction(async () => {
    let shop = fallbackShop;

    try {
      const auth = await authenticate.webhook(request);
      shop = auth.shop || shop;
      console.log(`Received ${auth.topic} webhook for ${shop}`);
    } catch (error) {
      // HMAC / validation failures must propagate (401/400/405).
      if (
        error instanceof Response &&
        [401, 400, 405].includes(error.status)
      ) {
        throw error;
      }
      // After uninstall, offline token refresh often fails with 500.
      // Still clean up using the shop domain header.
      console.error(
        `authenticate.webhook failed for uninstall (${shop}); cleaning up anyway`,
        error instanceof Response ? error.status : error,
      );
    }

    if (!shop) return;

    try {
      await deleteShopData(shop);
    } catch (error) {
      console.error(`Failed to clean shop data for ${shop}:`, error);
    }
  });
};
