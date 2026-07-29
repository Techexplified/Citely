import { Form, Navigate, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Button,
  Card,
  CyPage,
  DataTable,
  EnginePill,
  EngineSelect,
  Metric,
  PageHeader,
  ScanBanner,
  ScoreRing,
  StandingsList,
  TextLink,
} from "../components/citely-ui";
import { ensurePrimaryPrompt, ensureShop } from "../models/shop.server";
import { getAiOrderStats } from "../models/orders.server";
import { listCompetitors } from "../models/competitor.server";
import { listActivePrompts } from "../models/prompt.server";
import { buildCompetitorStandings } from "../services/analytics.server";
import {
  listAvailableEngines,
  parseEnginesFromFormData,
} from "../services/engines.server";
import { getScanStats, runShopScan } from "../services/scan.server";
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

function formatWhen(value) {
  if (!value) return "Never scanned";
  const diff = Date.now() - new Date(value).getTime();
  const hours = Math.max(1, Math.round(diff / 3600000));
  if (hours < 48) return `Last scan ${hours}h ago`;
  return `Last scan ${new Date(value).toLocaleDateString()}`;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  if (!shop.onboardingDone) {
    return {
      onboardingDone: false,
      shop: null,
      stats: null,
      revenue: null,
      standings: null,
      recentOrders: [],
    };
  }

  await ensurePrimaryPrompt(shop);

  const [stats, revenue, competitors, prompts] = await Promise.all([
    getScanStats(shop.id),
    getAiOrderStats(shop.id),
    listCompetitors(shop.id),
    listActivePrompts(shop.id),
  ]);

  const standings = buildCompetitorStandings(
    shop,
    stats.mentions || [],
    competitors,
  );

  const engines = listAvailableEngines().map(({ id, label, available }) => ({
    id,
    label,
    available,
  }));

  return {
    onboardingDone: true,
    shop,
    stats,
    revenue,
    standings,
    promptCount: prompts.length,
    recentOrders: revenue.orders.slice(0, 5),
    engines,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  await ensurePrimaryPrompt(shop);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "run_scan") {
    const engines = parseEnginesFromFormData(formData);
    return runShopScan(shop, { engines });
  }

  return { ok: false, error: "Unknown action." };
};

export default function Overview() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [selectedEngines, setSelectedEngines] = useState(() =>
    (data.engines || []).map((engine) => engine.id),
  );

  useEffect(() => {
    const ids = (data.engines || []).map((engine) => engine.id);
    setSelectedEngines((prev) => {
      const stillValid = prev.filter((id) => ids.includes(id));
      return stillValid.length ? stillValid : ids;
    });
  }, [data.engines]);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      shopify.toast.show(
        actionData.message ||
          "Scan complete. Mention rates updated across engines.",
      );
    } else if (actionData.error) {
      shopify.toast.show(actionData.error);
    }
  }, [actionData, shopify]);

  const isScanning =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "run_scan";

  useEffect(() => {
    if (!isScanning) return undefined;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 2500);
    return () => clearInterval(id);
  }, [isScanning, revalidator]);

  if (!data.onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  const { shop, stats, revenue, standings, recentOrders } = data;

  const currency = shop.currency || "USD";
  const score = Math.round((stats?.mentionRate || 0) * 100);
  const topRival = (standings?.standings || [])
    .filter((row) => !row.isYou)
    .slice(0, 1);
  const progress = stats?.progress;
  const scanError =
    !isScanning && progress?.status === "error" ? progress.error : null;

  return (
    <CyPage>
      <Form id="run-scan-form" method="post">
        <input type="hidden" name="intent" value="run_scan" />
      </Form>

      <PageHeader
        title="Overview"
        subtitle={`How AI sees ${shop.storeName || "your store"} and what it is worth.`}
        meta={
          <>
            {shop.storeName || shop.shopDomain}
            {shop.niche ? ` · ${shop.niche}` : ""} · {formatWhen(stats?.lastScanAt)}
          </>
        }
        actions={
          <Button
            type="submit"
            form="run-scan-form"
            disabled={isScanning || selectedEngines.length === 0}
          >
            {isScanning ? "Scanning…" : "Run scan"}
          </Button>
        }
      />

      <ScanBanner
        scanning={isScanning || progress?.status === "running"}
        progress={
          isScanning
            ? progress?.status === "running"
              ? progress
              : { completed: 0, total: 0 }
            : progress
        }
        lastScanAt={stats?.lastScanAt}
        error={scanError}
      />

      <div className="cy-card">
        <EngineSelect
          engines={data.engines || []}
          selected={selectedEngines}
          onChange={setSelectedEngines}
          formId="run-scan-form"
          label="Engines to check"
        />
      </div>

      <div className="cy-grid-3">
        <Card label="AI visibility score">
          <div className="cy-score">
            <ScoreRing score={score} />
            <div>
              <div className="cy-metric__hint">
                Named in {stats?.promptsMentioned || 0} of{" "}
                {stats?.promptsTracked || 0} tracked questions
              </div>
              <div className="cy-metric__hint" style={{ marginTop: 8 }}>
                Across {stats?.recentRunCount || 0} completed scan
                {(stats?.recentRunCount || 0) === 1 ? "" : "s"}
              </div>
              <div style={{ marginTop: 12 }}>
                <TextLink to="/app/visibility">Open visibility →</TextLink>
              </div>
            </div>
          </div>
        </Card>

        <Card label="AI revenue · this month">
          <Metric
            value={formatMoney(revenue?.revenue, currency)}
            hint={`${revenue?.count || 0} orders · AOV ${formatMoney(revenue?.aov, currency)}`}
          />
          <div style={{ marginTop: 16 }}>
            <TextLink to="/app/revenue">Revenue details →</TextLink>
          </div>
        </Card>

        <Card
          label="Who AI recommends instead"
          action={
            standings?.yourRank ? (
              <span className="cy-alert" style={{ fontSize: 12, fontWeight: 700 }}>
                rank #{standings.yourRank}
              </span>
            ) : null
          }
        >
          <StandingsList rows={topRival} />
          <div style={{ marginTop: 14 }}>
            <TextLink to="/app/competitors">View full standings →</TextLink>
          </div>
        </Card>
      </div>

      <Card
        label="Recent AI-referred orders"
        action={<TextLink to="/app/revenue">Details →</TextLink>}
      >
        <DataTable
          empty="No AI-referred orders yet. They’ll show up here once shoppers arrive from AI and check out."
          columns={[
            { key: "orderId", label: "Order" },
            {
              key: "engine",
              label: "From",
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
          rows={recentOrders}
        />
      </Card>
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
