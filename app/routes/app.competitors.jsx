import { useEffect, useState } from "react";
import {
  Form,
  Navigate,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Button,
  Card,
  CyPage,
  Metric,
  MetricRow,
  PageHeader,
  StandingsList,
  TextLink,
} from "../components/citely-ui";
import { listCompetitors, trackCompetitor } from "../models/competitor.server";
import { listActivePrompts } from "../models/prompt.server";
import { ensurePrimaryPrompt, ensureShop } from "../models/shop.server";
import {
  buildCompetitorStandings,
  buildVisibilityRows,
} from "../services/analytics.server";
import { getScanStats, runShopScan } from "../services/scan.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  if (!shop.onboardingDone) {
    return { onboardingDone: false };
  }

  await ensurePrimaryPrompt(shop);

  const [prompts, stats, competitors] = await Promise.all([
    listActivePrompts(shop.id),
    getScanStats(shop.id),
    listCompetitors(shop.id),
  ]);

  const standings = buildCompetitorStandings(
    shop,
    stats.mentions || [],
    competitors,
  );
  const visibilityRows = buildVisibilityRows(prompts, stats.mentions || []);
  const losing = visibilityRows.filter((row) => row.status === "missing");

  return {
    onboardingDone: true,
    shop,
    standings,
    competitors,
    losing,
    stats,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  await ensurePrimaryPrompt(shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "run_scan") {
    return runShopScan(shop);
  }

  if (intent === "track_competitor") {
    const name = String(formData.get("name") || "");
    try {
      await trackCompetitor(shop.id, name);
      return { ok: true, message: "Competitor tracked." };
    } catch (error) {
      return { ok: false, error: error.message || "Could not track competitor." };
    }
  }

  return { ok: false, error: "Unknown action." };
};

export default function CompetitorsPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [name, setName] = useState("");
  const [showTrack, setShowTrack] = useState(false);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok && actionData.message) shopify.toast.show(actionData.message);
    else if (actionData.ok) shopify.toast.show("Scan complete.");
    else if (actionData.error) shopify.toast.show(actionData.error);
    if (actionData.ok && actionData.message?.includes("tracked")) {
      setName("");
      setShowTrack(false);
    }
  }, [actionData, shopify]);

  if (!data.onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  const isScanning =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "run_scan";
  const isTracking =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "track_competitor";

  const { shop, standings, losing } = data;
  const leaderName =
    standings.standings?.find((row) => !row.isYou)?.name || "leader";

  return (
    <CyPage>
      <Form id="competitors-scan-form" method="post">
        <input type="hidden" name="intent" value="run_scan" />
      </Form>

      <PageHeader
        title="Competitors"
        subtitle="Who AI recommends in your niche, and the questions they win that you don't."
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowTrack((v) => !v)}>
              + Track competitor
            </Button>
            <Button
              type="submit"
              form="competitors-scan-form"
              disabled={isScanning}
            >
              {isScanning ? "Scanning…" : "Run scan"}
            </Button>
          </>
        }
      />

      {showTrack ? (
        <Form method="post" className="cy-card">
          <input type="hidden" name="intent" value="track_competitor" />
          <div className="cy-form-inline">
            <input
              className="cy-input"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="DreamWell"
            />
            <Button type="submit" disabled={isTracking}>
              {isTracking ? "Saving…" : "Track"}
            </Button>
            <Button variant="quiet" onClick={() => setShowTrack(false)}>
              Cancel
            </Button>
          </div>
        </Form>
      ) : null}

      <MetricRow columns={4}>
        <Card>
          <Metric
            value={`${standings.yourShare || 0}%`}
            hint="Your share of voice"
          />
        </Card>
        <Card>
          <Metric
            value={
              standings.yourRank
                ? `#${standings.yourRank}`
                : "—"
            }
            hint={
              standings.totalBrands
                ? `of ${standings.totalBrands} brands ranked`
                : "No rank yet"
            }
          />
        </Card>
        <Card>
          <Metric
            value={
              standings.gapToLeader
                ? `-${standings.gapToLeader} pts`
                : "0 pts"
            }
            hint={`Gap to ${leaderName}`}
          />
        </Card>
        <Card>
          <Metric
            value={
              <span>
                <span className="cy-dot cy-dot--red" />
                {losing.length}
              </span>
            }
            hint="Questions you're losing"
            tone={losing.length ? "alert" : undefined}
          />
        </Card>
      </MetricRow>

      <Card
        label="Share of voice"
        action={
          <span className="cy-metric__hint">
            How often each brand is named across scans
          </span>
        }
      >
        <StandingsList rows={standings.standings || []} />
      </Card>

      <Card
        label="Where rivals beat you"
        action={
          <span className="cy-metric__hint">
            {losing.length} question{losing.length === 1 ? "" : "s"}
          </span>
        }
      >
        {losing.length ? (
          <div className="cy-list">
            {losing.map((row) => {
              const rival =
                row.mentions.find((m) => m.rivalCited)?.rivalCited ||
                "A rival brand";
              return (
                <div className="cy-row" key={row.prompt.id}>
                  <div className="cy-row__main">
                    <div>
                      <p className="cy-row__title">{row.prompt.text}</p>
                      <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                        Winner signal: {rival}
                      </div>
                    </div>
                    <TextLink to="/app/fixes">Create fix →</TextLink>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cy-empty">
            No losing questions in the latest scan for {shop.storeName || "you"}.
          </div>
        )}
      </Card>
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
