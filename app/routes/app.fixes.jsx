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
    if (!fix) return { ok: false, error: "Fix not found." };

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
    if (!fix) return { ok: false, error: "Fix not found." };
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

function getDraft(fix, actionData) {
  return (
    fix.meta?.generatedContent ||
    (actionData?.fixId === fix.id ? actionData.generated : null)
  );
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
      setFilter("all");
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

  const generatedFixes = useMemo(() => {
    return (data.fixes || []).filter((fix) => {
      const draft = getDraft(fix, actionData);
      return fix.status === "applied" && draft?.body;
    });
  }, [data.fixes, actionData]);

  if (!data.onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  const fixes = data.fixes || [];
  const todoCount = fixes.filter((fix) => fix.status !== "applied").length;
  const appliedCount = fixes.filter((fix) => fix.status === "applied").length;

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
        title="Fixes"
        subtitle="Generate articles, blogs, and Reddit drafts that improve AI visibility — then follow the guide on where to publish them."
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

      <section className="cy-section">
        <div className="cy-section__head">
          <h2 className="cy-section__title">Generate content</h2>
          <p className="cy-section__subtitle">
            Create the draft first. Edit claims so they match your products,
            then use the publishing guide below.
          </p>
        </div>

        <div className="cy-list">
          {filtered.length ? (
            filtered.map((fix) => {
              const open = expandedId === fix.id;
              const generating = submittingFixId === fix.id;
              const applyLabel = fix.meta?.applyLabel || "Generate draft";
              const draft = getDraft(fix, actionData);
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
                      {fix.meta?.promptText ? (
                        <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                          Buyer question: {fix.meta.promptText}
                        </div>
                      ) : null}
                    </div>
                    <div className="cy-actions">
                      {draft?.body ? (
                        <Button
                          variant="quiet"
                          onClick={() => setExpandedId(open ? null : fix.id)}
                        >
                          {open ? "Hide draft" : "View draft"}
                        </Button>
                      ) : null}
                      {fix.status === "applied" ? (
                        <>
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="generate_content"
                            />
                            <input type="hidden" name="fixId" value={fix.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              disabled={generating}
                            >
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
                  {open && draft?.body ? (
                    <div className="cy-content-panel">
                      <div className="cy-draft">
                        <div className="cy-draft__head">
                          <div>
                            <div className="cy-content-panel__label">Draft</div>
                            {draft.title ? (
                              <div className="cy-draft__title">{draft.title}</div>
                            ) : null}
                          </div>
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
                        <pre className="cy-draft__body">{draft.body}</pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="cy-empty">
              No fixes in this filter. Run a scan from Visibility to add drafts
              for questions you’re missing.
            </div>
          )}
        </div>
      </section>

      <section className="cy-section">
        <div className="cy-section__head">
          <h2 className="cy-section__title">What to do with that content</h2>
          <p className="cy-section__subtitle">
            Where to publish each draft so buyers — and AI engines — can find
            you.
          </p>
        </div>

        <div className="cy-list">
          <div className="cy-row cy-fix-card">
            <div className="cy-content-panel__label">Quick playbook</div>
            <ol className="cy-steps" style={{ marginTop: 8 }}>
              <li>
                <strong>Articles & blogs</strong> — publish on your Shopify
                blog, Medium, LinkedIn, or Substack. Link the URL from your
                homepage or footer.
              </li>
              <li>
                <strong>Reddit threads</strong> — post in niche recommendation
                subs as a helpful discussion. Soft brand mention; follow each
                sub’s rules.
              </li>
              <li>
                <strong>Buyer-question answers</strong> — publish the guide,
                then also search Reddit/forums for that exact question and share
                a helpful reply with your link.
              </li>
              <li>
                <strong>After it’s live</strong> — wait a few days, then re-run
                Visibility to see if mention rate improves.
              </li>
            </ol>
          </div>

          {generatedFixes.length ? (
            generatedFixes.map((fix) => {
              const draft = getDraft(fix, actionData);
              const postTargets = Array.isArray(
                draft?.postTargets || fix.meta?.postTargets,
              )
                ? draft?.postTargets || fix.meta.postTargets
                : [];
              const format = draft?.format || fix.meta?.format || "article";

              return (
                <div className="cy-row cy-fix-card" key={`guide-${fix.id}`}>
                  <div className="cy-badge-row">
                    <StatusPill>{formatLabel(format)}</StatusPill>
                    <StatusPill tone="ok">Ready</StatusPill>
                  </div>
                  <p className="cy-row__title" style={{ marginTop: 10 }}>
                    {draft?.title || fix.title}
                  </p>
                  <div className="cy-metric__hint" style={{ marginTop: 6 }}>
                    {fix.title}
                  </div>

                  {postTargets.length ? (
                    <div className="cy-post-targets" style={{ marginTop: 12 }}>
                      <div className="cy-content-panel__label">
                        Where to publish
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

                  {draft?.guide ? (
                    <div className="cy-draft" style={{ marginTop: 12 }}>
                      <div className="cy-draft__head">
                        <div className="cy-content-panel__label">
                          Publishing guide
                        </div>
                        <Button
                          variant="quiet"
                          onClick={() =>
                            copyText(draft.guide, "Guide copied")
                          }
                        >
                          Copy guide
                        </Button>
                      </div>
                      <pre className="cy-draft__body">{draft.guide}</pre>
                    </div>
                  ) : (
                    <ol className="cy-steps">
                      {(Array.isArray(fix.meta?.steps)
                        ? fix.meta.steps
                        : []
                      ).map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })
          ) : (
            <div className="cy-empty">
              Generate a draft above — its publishing guide will show up here
              with exact places to post.
            </div>
          )}
        </div>
      </section>
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
