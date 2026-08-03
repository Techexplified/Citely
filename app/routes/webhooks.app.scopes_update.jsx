import { authenticate } from "../shopify.server";
import db from "../db.server";

function scopesToString(current) {
  if (Array.isArray(current)) return current.filter(Boolean).join(",");
  if (current == null) return "";
  return String(current);
}

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const scope = scopesToString(payload?.current);

  try {
    if (shop && scope) {
      // Prefer shop-scoped update so a stale session id cannot 500 the webhook.
      const result = await db.session.updateMany({
        where: { shop },
        data: { scope },
      });

      // Fallback for rare cases where only the loaded session row should change.
      if (result.count === 0 && session?.id) {
        await db.session.updateMany({
          where: { id: session.id },
          data: { scope },
        });
      }
    }
  } catch (error) {
    // HMAC already verified — acknowledge delivery so Partner Dashboard
    // does not mark this topic as failing.
    console.error(`Failed to persist scopes for ${shop}:`, error);
  }

  return new Response();
};
