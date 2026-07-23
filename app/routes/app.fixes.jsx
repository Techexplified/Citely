import { useEffect, useMemo, useState } from "react";
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
  FilterPills,
  InfoNote,
  Metric,
  MetricRow,
  PageHeader,
  StatusPill,
} from "../components/citely-ui";
import {
  ensureBaselineFixes,
  listFixes,
  setFixStatus,
} from "../models/fixes.server";
import { listActivePrompts } from "../models/prompt.server";
import { ensurePrimaryPrompt, ensureShop } from "../models/shop.server";
import { buildVisibilityRows } from "../services/analytics.server";
import { getScanStats } from "../services/scan.server";
import { authenticate } from "../shopify.server";
import { getThemeEmbedEditorUrl } from "../utils/theme.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  if (!shop.onboardingDone) {
    return { onboardingDone: false };
  }

  await ensurePrimaryPrompt(shop);

  const [prompts, stats] = await Promise.all([
    listActivePrompts(shop.id),
    getScanStats(shop.id),
  ]);
  const rows = buildVisibilityRows(prompts, stats.mentions || []);
  const missing = rows
    .filter((row) => row.status === "missing")
    .map((row) => row.prompt.text);

  await ensureBaselineFixes(shop, missing);
  const fixes = await listFixes(shop.id);

  return {
    onboardingDone: true,
    shop,
    fixes,
    themeEditorUrl: getThemeEmbedEditorUrl(session.shop),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const fixId = String(formData.get("fixId") || "");

  if (intent === "apply_fix") {
    const fix = (await listFixes(shop.id)).find((item) => item.id === fixId);
    if (!fix) return { ok: false, error: "Fix not found." };

    if (fix.status === "needs_embed" || fix.meta?.needsEmbed) {
      if (!shop.themeEmbedActive) {
        return {
          ok: false,
          error:
            "Turn on the Citely theme embed in your theme editor first.",
        };
      }
    }

    await setFixStatus(shop.id, fixId, "applied");
    return { ok: true, message: "Marked as applied. Re-scan after store changes." };
  }

  if (intent === "undo_fix") {
    const fix = (await listFixes(shop.id)).find((item) => item.id === fixId);
    if (!fix) return { ok: false, error: "Fix not found." };
    const nextStatus =
      fix.meta?.needsEmbed && !shop.themeEmbedActive ? "needs_embed" : "todo";
    await setFixStatus(shop.id, fixId, nextStatus);
    return { ok: true, message: "Fix moved back to to do." };
  }

  if (intent === "apply_high") {
    const fixes = await listFixes(shop.id);
    let applied = 0;
    for (const fix of fixes) {
      if (fix.impact !== "high") continue;
      if (fix.status === "applied") continue;
      if (fix.status === "needs_embed" && !shop.themeEmbedActive) continue;
      await setFixStatus(shop.id, fix.id, "applied");
      applied += 1;
    }
    return {
      ok: true,
      message: applied
        ? `Applied ${applied} high impact fix${applied === 1 ? "" : "es"}.`
        : "No high impact fixes ready to apply.",
    };
  }

  return { ok: false, error: "Unknown action." };
};

export default function FixesPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [filter, setFilter] = useState("todo");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok && actionData.message) shopify.toast.show(actionData.message);
    else if (actionData.error) shopify.toast.show(actionData.error);
  }, [actionData, shopify]);

  const filtered = useMemo(() => {
    const fixes = data.fixes || [];
    if (filter === "todo") {
      return fixes.filter(
        (fix) => fix.status === "todo" || fix.status === "needs_embed",
      );
    }
    if (filter === "applied") {
      return fixes.filter((fix) => fix.status === "applied");
    }
    return fixes;
  }, [data.fixes, filter]);

  if (!data.onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  const fixes = data.fixes || [];
  const todoCount = fixes.filter(
    (fix) => fix.status === "todo" || fix.status === "needs_embed",
  ).length;
  const appliedCount = fixes.filter((fix) => fix.status === "applied").length;
  const highCount = fixes.filter(
    (fix) =>
      fix.impact === "high" &&
      (fix.status === "todo" || fix.status === "needs_embed"),
  ).length;
  const estLift = todoCount * 4;
  const isSubmitting = navigation.state === "submitting";

  return (
    <CyPage>
      <Form method="post" id="apply-high-form">
        <input type="hidden" name="intent" value="apply_high" />
      </Form>

      <PageHeader
        title="Fixes"
        subtitle="Ranked by impact on your AI visibility. Track progress here."
        actions={
          <>
            <FilterPills
              value={filter}
              onChange={setFilter}
              options={[
                { id: "todo", label: `To do ${todoCount}` },
                { id: "applied", label: `Applied ${appliedCount}` },
                { id: "all", label: `All ${fixes.length}` },
              ]}
            />
            <Button
              type="submit"
              form="apply-high-form"
              disabled={
                isSubmitting &&
                navigation.formData?.get("intent") === "apply_high"
              }
            >
              Apply high impact
            </Button>
          </>
        }
      />

      <MetricRow columns={4}>
        <Card>
          <Metric value={todoCount} hint="To do" />
        </Card>
        <Card>
          <Metric value={appliedCount} hint="Applied" />
        </Card>
        <Card>
          <Metric value={highCount} hint="High impact left" />
        </Card>
        <Card>
          <Metric
            value={`+${estLift}`}
            hint="Est. lift points (directional only)"
          />
        </Card>
      </MetricRow>

      {!data.shop.themeEmbedActive ? (
        <InfoNote>
          Some fixes need the Citely theme embed.{" "}
          <a className="cy-link" href={data.themeEditorUrl} target="_blank" rel="noreferrer">
            Turn on embed →
          </a>
        </InfoNote>
      ) : null}

      <div className="cy-list">
        {filtered.length ? (
          filtered.map((fix) => {
            const open = expandedId === fix.id;
            return (
              <div className="cy-row cy-fix-card" key={fix.id}>
                <div className="cy-fix-card__top">
                  <div>
                    <div className="cy-badge-row">
                      <StatusPill>{fix.impact}</StatusPill>
                      <StatusPill
                        tone={
                          fix.status === "applied"
                            ? "ok"
                            : fix.status === "needs_embed"
                              ? "bad"
                              : "neutral"
                        }
                      >
                        {fix.status}
                      </StatusPill>
                    </div>
                    <p className="cy-row__title" style={{ marginTop: 10 }}>
                      {fix.title}
                    </p>
                    <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                      {fix.meta?.description || "Citely recommended action."}
                    </div>
                  </div>
                  <div className="cy-actions">
                    <Button
                      variant="quiet"
                      onClick={() => setExpandedId(open ? null : fix.id)}
                    >
                      {open ? "Hide" : "Details"}
                    </Button>
                    {fix.status === "applied" ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="undo_fix" />
                        <input type="hidden" name="fixId" value={fix.id} />
                        <Button type="submit" variant="ghost">
                          Undo
                        </Button>
                      </Form>
                    ) : fix.status === "needs_embed" ? (
                      <Button variant="ghost" href={data.themeEditorUrl}>
                        Needs embed
                      </Button>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="apply_fix" />
                        <input type="hidden" name="fixId" value={fix.id} />
                        <Button type="submit">Apply</Button>
                      </Form>
                    )}
                  </div>
                </div>
                {open ? (
                  <div className="cy-metric__hint">
                    {fix.meta?.promptText
                      ? `Linked buyer question: ${fix.meta.promptText}`
                      : "After you apply store changes, run another scan. Mention rate is judged across multiple runs."}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="cy-empty">
            No fixes in this filter. Run a scan from Visibility to generate gap
            fixes.
          </div>
        )}
      </div>
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
