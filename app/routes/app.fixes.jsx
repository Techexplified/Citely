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
  getFixById,
  listFixes,
  setFixStatus,
} from "../models/fixes.server";
import { listActivePrompts } from "../models/prompt.server";
import { ensurePrimaryPrompt, ensureShop } from "../models/shop.server";
import { applyFixToStore } from "../services/apply-fix.server";
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
    missingCount: missing.length,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const fixId = String(formData.get("fixId") || "");

  if (intent === "apply_fix") {
    const fix = await getFixById(shop.id, fixId);
    if (!fix) return { ok: false, error: "Fix not found." };

    if (fix.status === "needs_embed" || fix.meta?.needsEmbed) {
      if (!shop.themeEmbedActive) {
        return {
          ok: false,
          error: "Turn on the Citely theme embed in your theme editor first.",
          openEmbed: true,
        };
      }
    }

    try {
      const applied = await applyFixToStore(admin, shop, fix);
      if (!applied.ok) {
        return {
          ok: false,
          error: applied.error || "Could not apply fix.",
          openEmbed: applied.needsEmbed,
        };
      }

      await setFixStatus(shop.id, fixId, "applied", {
        appliedAt: new Date().toISOString(),
        applyResult: applied.result || null,
      });

      return { ok: true, message: applied.message };
    } catch (error) {
      const message = error?.message || "Could not apply fix to the store.";
      // Common when write_content was just added and merchant hasn’t re-authed
      if (/access|scope|permission|denied/i.test(message)) {
        return {
          ok: false,
          error:
            "Shopify blocked this write. Reinstall / re-approve the app so write_content is granted, then try again.",
        };
      }
      return { ok: false, error: message };
    }
  }

  if (intent === "undo_fix") {
    const fix = await getFixById(shop.id, fixId);
    if (!fix) return { ok: false, error: "Fix not found." };
    const nextStatus =
      fix.meta?.needsEmbed && !shop.themeEmbedActive ? "needs_embed" : "todo";
    await setFixStatus(shop.id, fixId, nextStatus);
    return { ok: true, message: "Fix moved back to to do." };
  }

  return { ok: false, error: "Unknown action." };
};

function statusLabel(status) {
  if (status === "needs_embed") return "Needs embed";
  if (status === "applied") return "Applied";
  return "To do";
}

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

  const submittingFixId =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("fixId") || "")
      : "";

  return (
    <CyPage>
      <PageHeader
        title="Fixes"
        subtitle="Concrete store changes that improve AI visibility. Apply writes to your Shopify store."
        actions={
          <FilterPills
            value={filter}
            onChange={setFilter}
            options={[
              { id: "todo", label: `To do ${todoCount}` },
              { id: "applied", label: `Applied ${appliedCount}` },
              { id: "all", label: `All ${fixes.length}` },
            ]}
          />
        }
      />

      <MetricRow columns={3}>
        <Card>
          <Metric value={todoCount} hint="To do" />
        </Card>
        <Card>
          <Metric value={appliedCount} hint="Applied on store" />
        </Card>
        <Card>
          <Metric
            value={data.missingCount || 0}
            hint="Questions you're still missing"
            tone={(data.missingCount || 0) > 0 ? "alert" : undefined}
          />
        </Card>
      </MetricRow>

      {!data.shop.themeEmbedActive ? (
        <InfoNote>
          Schema fixes need the Citely theme embed.{" "}
          <a
            className="cy-link"
            href={data.themeEditorUrl}
            target="_blank"
            rel="noreferrer"
          >
            Turn on embed →
          </a>
        </InfoNote>
      ) : null}

      <InfoNote>
        Apply creates pages or updates product descriptions in Shopify. Review
        drafts before publishing. After changes go live, re-run a Visibility
        scan.
      </InfoNote>

      <div className="cy-list">
        {filtered.length ? (
          filtered.map((fix) => {
            const open = expandedId === fix.id;
            const applying = submittingFixId === fix.id;
            const steps = Array.isArray(fix.meta?.steps) ? fix.meta.steps : [];
            const applyLabel = fix.meta?.applyLabel || "Apply to store";
            const resultUrl = fix.meta?.applyResult?.url;

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
                        {statusLabel(fix.status)}
                      </StatusPill>
                    </div>
                    <p className="cy-row__title" style={{ marginTop: 10 }}>
                      {fix.title}
                    </p>
                    <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                      {fix.meta?.description || "Recommended store action."}
                    </div>
                    {resultUrl ? (
                      <div style={{ marginTop: 8 }}>
                        <a
                          className="cy-link"
                          href={resultUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open created page →
                        </a>
                      </div>
                    ) : null}
                  </div>
                  <div className="cy-actions">
                    <Button
                      variant="quiet"
                      onClick={() => setExpandedId(open ? null : fix.id)}
                    >
                      {open ? "Hide steps" : "What to do"}
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
                        Open theme editor
                      </Button>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="apply_fix" />
                        <input type="hidden" name="fixId" value={fix.id} />
                        <Button type="submit" disabled={applying}>
                          {applying ? "Applying…" : applyLabel}
                        </Button>
                      </Form>
                    )}
                  </div>
                </div>
                {open ? (
                  <div>
                    {fix.meta?.promptText ? (
                      <div className="cy-metric__hint">
                        Linked buyer question: {fix.meta.promptText}
                      </div>
                    ) : null}
                    {steps.length ? (
                      <ol className="cy-steps">
                        {steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    ) : (
                      <div className="cy-metric__hint">
                        Apply this fix on your store, then re-scan Visibility.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="cy-empty">
            No fixes in this filter. Run a scan from Visibility to generate gap
            fixes for questions you’re missing.
          </div>
        )}
      </div>

      {highCount > 0 && filter === "todo" ? (
        <div className="cy-metric__hint">
          {highCount} high impact fix{highCount === 1 ? "" : "es"} left. Apply
          each one so Citely can write the change to Shopify.
        </div>
      ) : null}
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
