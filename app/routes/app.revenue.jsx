import { Navigate, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Card,
  CyPage,
  DataTable,
  EnginePill,
  Metric,
  MetricRow,
  PageHeader,
  ShareBar,
} from "../components/citely-ui";
import { getAiOrderStats } from "../models/orders.server";
import { ensureShop } from "../models/shop.server";
import { authenticate } from "../shopify.server";

function formatMoney(value, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value || 0);
  } catch {
    return `$${(value || 0).toFixed(0)}`;
  }
}

function toCsv(orders) {
  const header = ["orderId", "engine", "productTitle", "value", "orderedAt"];
  const lines = orders.map((order) =>
    [
      order.orderId,
      order.engine || "",
      `"${String(order.productTitle || "").replace(/"/g, '""')}"`,
      order.value || 0,
      new Date(order.orderedAt).toISOString(),
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  if (!shop.onboardingDone) {
    return { onboardingDone: false };
  }

  const stats = await getAiOrderStats(shop.id);
  return {
    onboardingDone: true,
    shop,
    stats,
    csv: toCsv(stats.orders),
  };
};

export default function RevenuePage() {
  const data = useLoaderData();

  if (!data.onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  const { shop, stats, csv } = data;
  const currency = shop.currency || "USD";
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const fileName = `${(shop.storeName || "citely")
    .toLowerCase()
    .replace(/\s+/g, "-")}-ai-orders.csv`;
  const maxEngine = Math.max(1, ...stats.byEngine.map((row) => row.revenue || 0));

  return (
    <CyPage>
      <PageHeader
        title="Revenue"
        subtitle={`The orders and dollars AI actually sends ${shop.storeName || "your store"}.`}
        meta="AI-attributed sales only. Totals can undercount real influence."
        actions={
          stats.orders.length ? (
            <a className="cy-btn cy-btn--ghost" href={csvHref} download={fileName}>
              Export CSV
            </a>
          ) : null
        }
      />

      <MetricRow columns={4}>
        <Card>
          <Metric
            value={formatMoney(stats.revenue, currency)}
            hint="AI revenue this month"
          />
        </Card>
        <Card>
          <Metric value={stats.count} hint="Orders" />
        </Card>
        <Card>
          <Metric
            value={formatMoney(stats.aov, currency)}
            hint="Average order value"
          />
        </Card>
        <Card>
          <Metric value="n/a" hint="% of store sales (coming soon)" />
        </Card>
      </MetricRow>

      <Card label="Revenue by AI engine">
        {stats.byEngine.length ? (
          <div className="cy-standings">
            {stats.byEngine.map((row) => (
              <div key={row.engine}>
                <div className="cy-stand-meta">
                  <EnginePill>{row.engine}</EnginePill>
                  <span style={{ marginLeft: "auto", fontWeight: 700 }}>
                    {formatMoney(row.revenue, currency)}
                  </span>
                </div>
                <ShareBar
                  value={Math.round((row.revenue / maxEngine) * 100)}
                  you
                />
                <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                  {row.orders} orders
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="cy-empty">No engine breakdown yet.</div>
        )}
      </Card>

      <Card label="Top products from AI">
        {stats.byProduct.length ? (
          <DataTable
            columns={[
              { key: "productTitle", label: "Product" },
              { key: "orders", label: "Orders" },
              {
                key: "aov",
                label: "AOV",
                render: (row) => formatMoney(row.aov, currency),
              },
              {
                key: "revenue",
                label: "Revenue",
                render: (row) => (
                  <strong>{formatMoney(row.revenue, currency)}</strong>
                ),
              },
            ]}
            rows={stats.byProduct.map((row) => ({
              ...row,
              id: row.productTitle,
            }))}
          />
        ) : (
          <div className="cy-empty">No AI-attributed products yet.</div>
        )}
      </Card>

      <Card label="AI-referred orders">
        <DataTable
          empty="No AI-referred orders yet. They’ll appear here as AI-driven checkouts come in."
          columns={[
            { key: "orderId", label: "Order" },
            {
              key: "engine",
              label: "Engine",
              render: (row) => <EnginePill>{row.engine || "AI"}</EnginePill>,
            },
            {
              key: "productTitle",
              label: "Product",
              render: (row) => row.productTitle || "—",
            },
            {
              key: "orderedAt",
              label: "Date",
              render: (row) => new Date(row.orderedAt).toLocaleDateString(),
            },
            {
              key: "value",
              label: "Value",
              render: (row) => (
                <strong>{formatMoney(row.value, currency)}</strong>
              ),
            },
          ]}
          rows={stats.orders}
        />
      </Card>
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
