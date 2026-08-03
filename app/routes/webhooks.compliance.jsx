import { authenticate } from "../shopify.server";
import {
  deleteShopData,
  getCustomerOrderData,
  redactCustomerOrderData,
} from "../models/shop.server";
import { handleWebhookAction } from "../utils/webhook.server";

/**
 * Mandatory App Store compliance webhooks.
 * authenticate.webhook verifies the Shopify HMAC header and returns 401 if invalid.
 * @see https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */
export const action = async ({ request }) => {
  return handleWebhookAction(async () => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST": {
        const orders = await getCustomerOrderData(
          shop,
          payload?.orders_requested,
        );
        console.log(
          `customers/data_request for ${shop}: ${orders.length} attributed order(s)`,
          {
            customerId: payload?.customer?.id,
            dataRequestId: payload?.data_request?.id,
            orderIds: payload?.orders_requested,
          },
        );
        break;
      }

      case "CUSTOMERS_REDACT": {
        const result = await redactCustomerOrderData(
          shop,
          payload?.orders_to_redact,
        );
        console.log(
          `customers/redact for ${shop}: deleted ${result.deleted} attributed order(s)`,
          {
            customerId: payload?.customer?.id,
            orderIds: payload?.orders_to_redact,
          },
        );
        break;
      }

      case "SHOP_REDACT": {
        const result = await deleteShopData(shop);
        console.log(
          `shop/redact for ${shop}: removed ${result.shop} shop row(s), ${result.sessions} session(s)`,
        );
        break;
      }

      default:
        console.warn(`Unhandled compliance webhook topic: ${topic}`);
        break;
    }
  });
};
