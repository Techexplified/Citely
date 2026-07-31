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
import { buildVisibilityRows } from "../services/analytics.server";
import { generateFixContent } from "../services/generate-content.server";
import { getScanStats } from "../services/scan.server";
import { authenticate } from "../shopify.server";

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
    missingCount: missing.length,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const fixId = String(formData.get("fixId") || "");

  if (intent === "generate_content") {
    const fix = await getFixById(shop.id, fixId);
    if (!fix) return { ok: false, error: "Content item not found." };

    try {
      const generated = await generateFixContent(shop, fix);
      if (!generated.ok) {
        return {
          ok: false,
          error: generated.error || "Could not generate draft.",
        };
      }

      await setFixStatus(shop.id, fixId, "applied", {
        generatedAt: generated.result?.generatedAt || new Date().toISOString(),
        generatedContent: generated.result || null,
        // Keep legacy field name so older UI bits don't break
        applyResult: generated.result || null,
        appliedAt: new Date().toISOString(),
      });

      return {
        ok: true,
        message: generated.message,
        fixId,
        generated: generated.result,
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Could not generate content.",
      };
    }
  }

  if (intent === "undo_fix") {
    const fix = await getFixById(shop.id, fixId);
    if (!fix) return { ok: false, error: "Content item not found." };
    await setFixStatus(shop.id, fixId, "todo", {
      generatedContent: null,
      generatedAt: null,
      applyResult: null,
      appliedAt: null,
    });
    return { ok: true, message: "Moved back to to do." };
  }

  return { ok: false, error: "Unknown action." };
};

function statusLabel(status) {
  if (status === "applied") return "Generated";
  return "To do";
}

function formatLabel(format) {
  if (format === "reddit") return "Reddit";
  if (format === "blog") return "Blog";
  if (format === "article") return "Article";
  return "Draft";
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
    if (actionData.ok && actionData.fixId) {
      setFilter("applied");
      setExpandedId(actionData.fixId);
    }
  }, [actionData, shopify]);

  const filtered = useMemo(() => {
    const fixes = data.fixes || [];
    if (filter === "todo") {
      return fixes.filter((fix) => fix.status !== "applied");
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
  const todoCount = fixes.filter((fix) => fix.status !== "applied").length;
  const appliedCount = fixes.filter((fix) => fix.status === "applied").length;
  const highCount = fixes.filter(
    (fix) => fix.impact === "high" && fix.status !== "applied",
  ).length;

  const submittingFixId =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("fixId") || "")
      : "";

  async function copyText(text, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      shopify.toast.show(label);
    } catch {
      shopify.toast.show("Could not copy — select the text manually.");
    }
  }

  return (
    <CyPage>
      <PageHeader
        title="Content"
        subtitle="Generate articles, blogs, and Reddit threads that improve AI visibility. You post them yourself — Citely doesn’t publish for you."
        actions={
          <FilterPills
            value={filter}
            onChange={setFilter}
            options={[
              { id: "todo", label: `To do ${todoCount}` },
              { id: "applied", label: `Generated ${appliedCount}` },
              { id: "all", label: `All ${fixes.length}` },
            ]}
          />
        }
      />

      <MetricRow columns={3}>
        <Card>
          <Metric value={todoCount} hint="Drafts to generate" />
        </Card>
        <Card>
          <Metric value={appliedCount} hint="Drafts ready" />
        </Card>
        <Card>
          <Metric
            value={data.missingCount || 0}
            hint="Questions you're still missing"
            tone={(data.missingCount || 0) > 0 ? "alert" : undefined}
          />
        </Card>
      </MetricRow>

      <InfoNote>
        Generate a draft, edit it so claims are accurate, then post where we
        suggest (blog, Medium, Reddit, niche directories). Re-scan Visibility after
        content is live.
      </InfoNote>

      <div className="cy-list">
        {filtered.length ? (
          filtered.map((fix) => {
            const open = expandedId === fix.id;
            const generating = submittingFixId === fix.id;
            const steps = Array.isArray(fix.meta?.steps) ? fix.meta.steps : [];
            const applyLabel = fix.meta?.applyLabel || "Generate draft";
            const draft =
              fix.meta?.generatedContent ||
              (actionData?.fixId === fix.id ? actionData.generated : null);
            const postTargets = Array.isArray(
              draft?.postTargets || fix.meta?.postTargets,
            )
              ? draft?.postTargets || fix.meta.postTargets
              : [];
            const format = draft?.format || fix.meta?.format || "article";

            return (
              <div className="cy-row cy-fix-card" key={fix.id}>
                <div className="cy-fix-card__top">
                  <div>
                    <div className="cy-badge-row">
                      <StatusPill>{fix.impact}</StatusPill>
                      <StatusPill
                        tone={fix.status === "applied" ? "ok" : "neutral"}
                      >
                        {statusLabel(fix.status)}
                      </StatusPill>
                      <StatusPill>{formatLabel(format)}</StatusPill>
                    </div>
                    <p className="cy-row__title" style={{ marginTop: 10 }}>
                      {fix.title}
                    </p>
                    <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                      {fix.meta?.description ||
                        "Generate content that helps AI discover your brand."}
                    </div>
                  </div>
                  <div className="cy-actions">
                    <Button
                      variant="quiet"
                      onClick={() => setExpandedId(open ? null : fix.id)}
                    >
                      {open ? "Hide details" : "What to do"}
                    </Button>
                    {fix.status === "applied" ? (
                      <>
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="generate_content"
                          />
                          <input type="hidden" name="fixId" value={fix.id} />
                          <Button type="submit" variant="ghost" disabled={generating}>
                            {generating ? "Generating…" : "Regenerate"}
                          </Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="undo_fix" />
                          <input type="hidden" name="fixId" value={fix.id} />
                          <Button type="submit" variant="ghost">
                            Undo
                          </Button>
                        </Form>
                      </>
                    ) : (
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="generate_content"
                        />
                        <input type="hidden" name="fixId" value={fix.id} />
                        <Button type="submit" disabled={generating}>
                          {generating ? "Generating…" : applyLabel}
                        </Button>
                      </Form>
                    )}
                  </div>
                </div>
                {open ? (
                  <div className="cy-content-panel">
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
                    ) : null}

                    {postTargets.length ? (
                      <div className="cy-post-targets">
                        <div className="cy-content-panel__label">
                          Where to post
                        </div>
                        <ul>
                          {postTargets.map((target) => (
                            <li key={target.name}>
                              <strong>{target.name}</strong>
                              {target.why ? (
                                <span className="cy-metric__hint">
                                  {" "}
                                  — {target.why}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {draft?.body ? (
                      <div className="cy-draft">
                        <div className="cy-draft__head">
                          <div>
                            <div className="cy-content-panel__label">
                              Your draft
                            </div>
                            {draft.title ? (
                              <div className="cy-draft__title">{draft.title}</div>
                            ) : null}
                          </div>
                          <div className="cy-actions">
                            <Button
                              variant="quiet"
                              onClick={() =>
                                copyText(
                                  draft.title
                                    ? `${draft.title}\n\n${draft.body}`
                                    : draft.body,
                                  "Draft copied",
                                )
                              }
                            >
                              Copy draft
                            </Button>
                          </div>
                        </div>
                        <pre className="cy-draft__body">{draft.body}</pre>
                      </div>
                    ) : (
                      <div className="cy-metric__hint">
                        Generate a draft, then copy it and publish where
                        suggested.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="cy-empty">
            No content items in this filter. Run a scan from Visibility to add
            drafts for questions you’re missing.
          </div>
        )}
      </div>

      {highCount > 0 && filter === "todo" ? (
        <div className="cy-metric__hint">
          {highCount} high impact draft{highCount === 1 ? "" : "s"} left.
          Generate each one, then post it yourself to improve AI visibility.
        </div>
      ) : null}
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
