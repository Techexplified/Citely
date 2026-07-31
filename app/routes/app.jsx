import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { ensureShop } from "../models/shop.server";
import { authenticate } from "../shopify.server";
import "../styles/citely.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    onboardingDone: Boolean(shop.onboardingDone),
  };
};

export default function App() {
  const { apiKey, onboardingDone } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      {onboardingDone ? (
        <s-app-nav>
          <s-link href="/app">Home</s-link>
          <s-link href="/app/visibility">Visibility</s-link>
          <s-link href="/app/competitors">Competitors</s-link>
          <s-link href="/app/revenue">Revenue</s-link>
          <s-link href="/app/fixes">Content</s-link>
        </s-app-nav>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
