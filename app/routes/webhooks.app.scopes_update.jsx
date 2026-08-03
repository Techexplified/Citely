import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleWebhookAction } from "../utils/webhook.server";

function scopesToString(current) {
  if (Array.isArray(current)) return current.filter(Boolean).join(",");
  if (current == null) return "";
  return String(current);
}

export const action = async ({ request }) => {
  return handleWebhookAction(async () => {
    const { payload, session, topic, shop } =
      await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    const scope = scopesToString(payload?.current);

    try {
      if (shop && scope) {
        const result = await db.session.updateMany({
          where: { shop },
          data: { scope },
        });

        if (result.count === 0 && session?.id) {
          await db.session.updateMany({
            where: { id: session.id },
            data: { scope },
          });
        }
      }
    } catch (error) {
      console.error(`Failed to persist scopes for ${shop}:`, error);
    }
  });
};
