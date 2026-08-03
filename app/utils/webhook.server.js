/**
 * Run a webhook action safely.
 * - Preserves 401/400/405 from authenticate.webhook (HMAC / validation).
 * - Turns unexpected errors (including library Response 500 from offline
 *   token refresh after uninstall) into 200 so Shopify stops retrying.
 */
export async function handleWebhookAction(work) {
  try {
    await work();
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      if ([401, 400, 405].includes(error.status)) {
        throw error;
      }
      console.error(
        `Webhook returned HTTP ${error.status}; acknowledging to stop retries`,
        error.statusText,
      );
      return new Response(null, { status: 200 });
    }
    console.error("Webhook processing error:", error);
    return new Response(null, { status: 200 });
  }
}

/** Best-effort shop domain from Shopify webhook headers. */
export function shopFromWebhookRequest(request) {
  return (
    request.headers.get("X-Shopify-Shop-Domain") ||
    request.headers.get("x-shopify-shop-domain") ||
    ""
  );
}
