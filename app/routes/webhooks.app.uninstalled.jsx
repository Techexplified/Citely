import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  try {
    if (session || shop) {
      await db.session.deleteMany({ where: { shop } });
    }
  } catch (error) {
    console.error(`Failed to clean sessions for ${shop}:`, error);
  }

  return new Response();
};
