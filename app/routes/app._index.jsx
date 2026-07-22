import { Navigate, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  return {
    onboardingDone: shop.onboardingDone,
    storeName: shop.storeName || session.shop,
    niche: shop.niche,
    primaryPrompt: shop.primaryPrompt,
    themeEmbedActive: shop.themeEmbedActive,
  };
};

export default function Index() {
  const {
    onboardingDone,
    storeName,
    niche,
    primaryPrompt,
    themeEmbedActive,
  } = useLoaderData();

  if (!onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  return (
    <s-page heading="Citely">
      <s-section heading={`Welcome back${storeName ? `, ${storeName}` : ""}`}>
        <s-stack gap="base">
          <s-paragraph>
            Citely tracks how often AI engines mention your store, helps you fix
            discoverability gaps, and attributes orders from AI referrers.
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>Niche focus: {niche || "not set"}</s-list-item>
            <s-list-item>
              Primary prompt: {primaryPrompt || "not set"}
            </s-list-item>
            <s-list-item>
              Theme embed: {themeEmbedActive ? "confirmed" : "pending"}
            </s-list-item>
          </s-unordered-list>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/onboarding" variant="secondary">
              Review setup
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="What comes next">
        <s-unordered-list>
          <s-list-item>Scheduled multi-engine mention scans</s-list-item>
          <s-list-item>Schema and llms.txt fixes</s-list-item>
          <s-list-item>AI-attributed order tracking</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
