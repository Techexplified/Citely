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
  CyPage,
  EngineMeter,
  EngineSelect,
  FilterPills,
  InfoNote,
  PageHeader,
  StatusPill,
  TextLink,
} from "../components/citely-ui";
import { ensurePrimaryPrompt, ensureShop } from "../models/shop.server";
import {
  addPrompt,
  deactivatePrompt,
  listActivePrompts,
} from "../models/prompt.server";
import { buildVisibilityRows } from "../services/analytics.server";
import {
  listAvailableEngines,
  parseEnginesFromFormData,
} from "../services/engines.server";
import { getScanStats, runShopScan } from "../services/scan.server";
import { authenticate } from "../shopify.server";

function splitExcerpt(rawExcerpt = "") {
  const text = String(rawExcerpt || "");
  const [brandPart, ...rest] = text.split("||");
  const brands = (brandPart || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const sources = rest
    .join("||")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  return { brands, sources };
}

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

  const engines = listAvailableEngines().map(({ id, label, available }) => ({
    id,
    label,
    available,
  }));

  return {
    onboardingDone: true,
    shop,
    prompts,
    stats,
    engines,
    rows: buildVisibilityRows(prompts, stats.mentions || []),
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

  if (intent === "add_prompt") {
    const text = String(formData.get("text") || "");
    try {
      await addPrompt(shop.id, text, "manual");
      return { ok: true, message: "Question added to tracking." };
    } catch (error) {
      return { ok: false, error: error.message || "Could not add question." };
    }
  }

  if (intent === "stop_prompt") {
    const promptId = String(formData.get("promptId") || "");
    await deactivatePrompt(shop.id, promptId);
    return { ok: true, message: "Stopped tracking that question." };
  }

  return { ok: false, error: "Unknown action." };
};

export default function VisibilityPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [showAdd, setShowAdd] = useState(false);
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
    if (actionData.ok && actionData.message?.includes("added")) {
      setNewQuestion("");
      setShowAdd(false);
    }
  }, [actionData, shopify]);

  const filteredRows = useMemo(() => {
    const rows = data.rows || [];
    if (filter === "mentioned") {
      return rows.filter(
        (row) => row.status === "mentioned" || row.status === "partial",
      );
    }
    if (filter === "missing") {
      return rows.filter((row) => row.status === "missing");
    }
    return rows;
  }, [data.rows, filter]);

  if (!data.onboardingDone) {
    return <Navigate to="/app/onboarding" replace />;
  }

  const isScanning =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "run_scan";
  const isAdding =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "add_prompt";

  const counts = {
    all: data.rows?.length || 0,
    mentioned:
      data.rows?.filter(
        (r) => r.status === "mentioned" || r.status === "partial",
      ).length || 0,
    missing: data.rows?.filter((r) => r.status === "missing").length || 0,
  };

  return (
    <CyPage>
      <Form id="visibility-scan-form" method="post">
        <input type="hidden" name="intent" value="run_scan" />
      </Form>

      <PageHeader
        title="Visibility"
        subtitle="The exact buyer questions we track, and whether AI names you."
        meta={
          <div className="cy-summary-inline">
            <span>
              <strong>{counts.all}</strong> Questions tracked
            </span>
            <span>
              <span className="cy-dot cy-dot--green" />
              <strong>{counts.mentioned}</strong> Mention you
            </span>
            <span>
              <span className="cy-dot cy-dot--red" />
              <strong>{counts.missing}</strong> You're invisible
            </span>
          </div>
        }
        actions={
          <>
            <FilterPills
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: `All ${counts.all}` },
                { id: "mentioned", label: `Mentioned ${counts.mentioned}` },
                { id: "missing", label: `Missing ${counts.missing}` },
              ]}
            />
            <Button variant="ghost" onClick={() => setShowAdd((v) => !v)}>
              + Add question
            </Button>
            <Button
              type="submit"
              form="visibility-scan-form"
              disabled={isScanning || selectedEngines.length === 0}
            >
              {isScanning ? "Scanning…" : "Run scan"}
            </Button>
          </>
        }
      />

      <div className="cy-card" style={{ marginBottom: 16 }}>
        <EngineSelect
          engines={data.engines || []}
          selected={selectedEngines}
          onChange={setSelectedEngines}
          formId="visibility-scan-form"
          label="Engines to check"
        />
      </div>

      <InfoNote>
        Mention results vary between runs. Citely tracks frequency over many
        scans instead of a single yes or no answer. Select one or more engines
        above — ChatGPT, Gemini, and Perplexity when configured.
      </InfoNote>

      {showAdd ? (
        <Form method="post" className="cy-card">
          <input type="hidden" name="intent" value="add_prompt" />
          <div className="cy-form-inline">
            <input
              className="cy-input"
              name="text"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="Best magnesium for sleep with third party testing?"
            />
            <Button type="submit" disabled={isAdding}>
              {isAdding ? "Adding…" : "Add"}
            </Button>
            <Button variant="quiet" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </Form>
      ) : null}

      <div className="cy-list">
        {filteredRows.length ? (
          filteredRows.map((row) => {
            const open = expandedId === row.prompt.id;
            const tone =
              row.status === "missing"
                ? "bad"
                : row.engineCount
                  ? "ok"
                  : "neutral";
            const pill =
              row.engineCount === 0
                ? "Not scanned"
                : row.status === "missing"
                  ? "Not found"
                  : `${row.mentionedCount} / ${row.engineCount} engines`;

            return (
              <div className="cy-row" key={row.prompt.id}>
                <div className="cy-row__main">
                  <p className="cy-row__title">{row.prompt.text}</p>
                  <div className="cy-row__side">
                    <StatusPill tone={tone}>{pill}</StatusPill>
                    <EngineMeter
                      mentions={row.mentions}
                      engines={data.stats?.engines || []}
                    />
                    <Button
                      variant="quiet"
                      onClick={() => setExpandedId(open ? null : row.prompt.id)}
                    >
                      {open ? "▴" : "▾"}
                    </Button>
                  </div>
                </div>

                {open ? (
                  <div style={{ marginTop: 14 }}>
                    {row.mentions.length ? (
                      <div className="cy-list">
                        {row.mentions.map((mention) => {
                          const excerpt = splitExcerpt(mention.rawExcerpt);
                          return (
                            <div
                              key={mention.id}
                              style={{
                                display: "grid",
                                gap: 6,
                                fontSize: 13,
                                color: "#6b7280",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 12,
                                }}
                              >
                                <span>{mention.engine}</span>
                                <span>
                                  {mention.mentioned
                                    ? `Named you${mention.rank ? ` (#${mention.rank})` : ""}`
                                    : `Missing${mention.rivalCited ? ` · ${mention.rivalCited}` : ""}`}
                                </span>
                              </div>
                              {excerpt.brands.length ? (
                                <div>
                                  Competitors: {excerpt.brands.slice(0, 6).join(", ")}
                                </div>
                              ) : null}
                              {excerpt.sources.length ? (
                                <div>
                                  Sources: {excerpt.sources.slice(0, 4).join(" · ")}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="cy-empty">Run a scan for engine detail.</div>
                    )}
                    <div className="cy-actions" style={{ marginTop: 12 }}>
                      {row.status === "missing" ? (
                        <TextLink to="/app/fixes">Create a fix →</TextLink>
                      ) : null}
                      <Form method="post">
                        <input type="hidden" name="intent" value="stop_prompt" />
                        <input type="hidden" name="promptId" value={row.prompt.id} />
                        <Button type="submit" variant="quiet">
                          Stop tracking
                        </Button>
                      </Form>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="cy-empty">
            No questions in this filter. Add a buyer question or run a scan.
          </div>
        )}
      </div>
    </CyPage>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
