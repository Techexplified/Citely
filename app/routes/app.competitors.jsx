import { useEffect, useState } from "react";
import {
  Form,
  Navigate,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Button,
  Card,
  CyPage,
  EngineSelect,
  Metric,
  MetricRow,
  PageHeader,
  ScanBanner,
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
import {
  listAvailableEngines,
  parseEnginesFromFormData,
} from "../services/engines.server";
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
    engines: listAvailableEngines().map(({ id, label, available }) => ({
      id,
      label,
      available,
    })),
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
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [name, setName] = useState("");
  const [showTrack, setShowTrack] = useState(false);
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
    if (actionData.ok && actionData.message) shopify.toast.show(actionData.message);
    else if (actionData.ok) shopify.toast.show("Scan complete.");
    else if (actionData.error) shopify.toast.show(actionData.error);
    if (actionData.ok && actionData.message?.includes("tracked")) {
      setName("");
      setShowTrack(false);
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

  const isTracking =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "track_competitor";

  const { shop, standings, losing } = data;
  const leaderName =
    standings.standings?.find((row) => !row.isYou)?.name || "leader";
  const progress = data.stats?.progress;
  const scanError =
    !isScanning && progress?.status === "error" ? progress.error : null;

  return (
    <CyPage>
      <Form id="competitors-scan-form" method="post">
        <input type="hidden" name="intent" value="run_scan" />
      </Form>

      <PageHeader
        title="Competitors"
        subtitle="Real brands AI recommends in your niche, and the questions they win."
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowTrack((v) => !v)}>
              + Track competitor
            </Button>
            <Button
              type="submit"
              form="competitors-scan-form"
              disabled={isScanning || selectedEngines.length === 0}
            >
              {isScanning ? "Scanning…" : "Run scan"}
            </Button>
          </>
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
        lastScanAt={data.stats?.lastScanAt}
        error={scanError}
      />

      <div className="cy-card">
        <EngineSelect
          engines={data.engines || []}
          selected={selectedEngines}
          onChange={setSelectedEngines}
          formId="competitors-scan-form"
          label="Engines to check"
        />
      </div>

      {showTrack ? (
        <Form method="post" className="cy-card">
          <input type="hidden" name="intent" value="track_competitor" />
          <div className="cy-form-inline">
            <input
              className="cy-input"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Brand name only"
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
            value={standings.yourRank ? `#${standings.yourRank}` : "—"}
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
              standings.gapToLeader ? `-${standings.gapToLeader} pts` : "0 pts"
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
            Brands only · URLs and publishers filtered out
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
                    <TextLink to="/app/fixes">Generate content →</TextLink>
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
