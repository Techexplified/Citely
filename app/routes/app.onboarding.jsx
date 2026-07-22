import { useEffect, useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop, upsertShopProfile } from "../models/shop.server";

const STEPS = [
  { id: 1, label: "Store" },
  { id: 2, label: "Persona" },
  { id: 3, label: "First scan" },
  { id: 4, label: "Activate" },
];

const NICHES = [
  { value: "supplements", label: "Supplements & wellness" },
  { value: "beauty", label: "Beauty & skincare" },
  { value: "fashion", label: "Fashion & apparel" },
  { value: "home", label: "Home & lifestyle" },
  { value: "food", label: "Food & beverage" },
  { value: "pets", label: "Pets" },
  { value: "other", label: "Other niche" },
];

const AUDIENCES = ["Men", "Women", "Businesses", "Everyone"];
const PURPOSES = [
  "Personal / everyday use",
  "Family or household",
  "Gifts & occasions",
  "Work / professional",
  "All kinds of purchases",
];
const BUDGETS = [
  "Budget-conscious",
  "Mid-range",
  "Premium",
  "Mixed buyers",
];

function buildPersona({ storeName, audience, purchasePurpose, budget }) {
  const who =
    audience === "Everyone"
      ? "a broad mix of shoppers"
      : audience === "Businesses"
        ? "business and trade buyers"
        : `mostly ${audience.toLowerCase()}`;

  const spend = budget.includes("Budget")
    ? "hunts for value and deals before committing"
    : budget.includes("Premium")
      ? "pays more for quality and a trusted brand"
      : budget.includes("Mid-range")
        ? "balances quality against price before buying"
        : "spends with a mix of impulse and careful comparison";

  const buys = purchasePurpose.includes("All kinds")
    ? "across everyday needs, gifts, and the occasional treat"
    : `mainly for ${purchasePurpose.toLowerCase()}`;

  return `Your buyer is ${who} shopping ${buys}. They ${spend}. Before purchasing they compare options and weigh price, product specifics, and reviews, which is exactly what they type into ChatGPT, Perplexity, and Gemini. Citely will track those buying questions and measure how often ${storeName || "your store"} appears across multiple runs.`;
}

function buildPromptSuggestions(storeName, niche) {
  const nicheLabel =
    NICHES.find((item) => item.value === niche)?.label?.toLowerCase() ||
    "products";

  return [
    `Best ${nicheLabel} stores online for quality and trust?`,
    `Where can I buy ${nicheLabel} online with reliable shipping?`,
    `${storeName || "This brand"} vs alternatives, which should I choose?`,
    `Top online stores for ${nicheLabel} right now?`,
  ];
}

function getThemeEditorUrl(shopDomain) {
  const handle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps`;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shopData = null;
  try {
    const response = await admin.graphql(`
      #graphql
      query OnboardingShop {
        shop {
          name
          email
          currencyCode
          primaryDomain {
            host
            url
          }
          myshopifyDomain
        }
      }
    `);
    const responseJson = await response.json();
    shopData = responseJson.data?.shop ?? null;
  } catch (error) {
    console.error("Failed to load Shopify shop details for onboarding", error);
  }

  const shop = await ensureShop(shopDomain, {
    storeName: shopData?.name || shopDomain,
    contactEmail: shopData?.email || null,
    currency: shopData?.currencyCode || null,
  });

  return {
    shop,
    shopInfo: {
      name: shopData?.name || shop.storeName || shopDomain,
      email: shopData?.email || shop.contactEmail || "",
      currency: shopData?.currencyCode || shop.currency || "",
      domain: shopData?.primaryDomain?.host || shopDomain,
      storefrontUrl: shopData?.primaryDomain?.url || "",
      myshopifyDomain: shopData?.myshopifyDomain || shopDomain,
    },
    themeEditorUrl: getThemeEditorUrl(shopDomain),
  };
};

export const action = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  const existing = await ensureShop(shopDomain);

  if (intent === "save_step_1") {
    const contactName = String(formData.get("contactName") || "").trim();
    const niche = String(formData.get("niche") || "").trim();
    const storeName = String(formData.get("storeName") || "").trim();
    const currency = String(formData.get("currency") || "").trim();
    const contactEmail = String(formData.get("contactEmail") || "").trim();

    const errors = {};
    if (!contactName) errors.contactName = "Enter your name so reports feel personal.";
    if (!niche) errors.niche = "Pick the niche Citely should optimize for.";
    if (!storeName) errors.storeName = "Store name is required.";

    if (Object.keys(errors).length) {
      return { ok: false, errors, step: 1 };
    }

    await upsertShopProfile(shopDomain, {
      contactName,
      niche,
      storeName,
      currency: currency || null,
      contactEmail: contactEmail || null,
      onboardingStep: Math.max(existing.onboardingStep, 2),
    });

    return { ok: true, step: 2 };
  }

  if (intent === "save_step_2") {
    const audience = String(formData.get("audience") || "").trim();
    const purchasePurpose = String(formData.get("purchasePurpose") || "").trim();
    const budget = String(formData.get("budget") || "").trim();
    const persona = String(formData.get("persona") || "").trim();
    const storeName = existing.storeName || shopDomain;

    const errors = {};
    if (!audience) errors.audience = "Select who you mostly sell to.";
    if (!purchasePurpose) errors.purchasePurpose = "Select why customers usually buy.";
    if (!budget) errors.budget = "Select a typical budget range.";
    if (!persona) errors.persona = "Add or generate a buyer persona.";

    if (Object.keys(errors).length) {
      return { ok: false, errors, step: 2 };
    }

    const primaryPrompt =
      existing.primaryPrompt ||
      buildPromptSuggestions(storeName, existing.niche)[0];

    await upsertShopProfile(shopDomain, {
      audience,
      purchasePurpose,
      budget,
      persona,
      primaryPrompt,
      onboardingStep: Math.max(existing.onboardingStep, 3),
    });

    return { ok: true, step: 3 };
  }

  if (intent === "save_step_3") {
    const primaryPrompt = String(formData.get("primaryPrompt") || "").trim();
    const errors = {};
    if (primaryPrompt.length < 12) {
      errors.primaryPrompt =
        "Write a real buying question customers would ask an AI.";
    }

    if (Object.keys(errors).length) {
      return { ok: false, errors, step: 3 };
    }

    await upsertShopProfile(shopDomain, {
      primaryPrompt,
      onboardingStep: Math.max(existing.onboardingStep, 4),
    });

    return { ok: true, step: 4, scanQueued: true };
  }

  if (intent === "complete_onboarding") {
    const themeEmbedActive = formData.get("themeEmbedActive") === "true";

    await upsertShopProfile(shopDomain, {
      themeEmbedActive,
      onboardingStep: 4,
      onboardingDone: true,
    });

    return redirect("/app");
  }

  if (intent === "go_step") {
    const step = Number(formData.get("step") || 1);
    const allowed = Math.min(Math.max(step, 1), existing.onboardingStep);
    return { ok: true, step: allowed };
  }

  return { ok: false, errors: { form: "Unknown action." }, step: existing.onboardingStep };
};

function ProgressRail({ currentStep, maxReached }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      {STEPS.map((step, index) => {
        const reached = step.id <= maxReached;
        const active = step.id === currentStep;
        const done = step.id < currentStep || (reached && step.id < maxReached && step.id !== currentStep);

        return (
          <s-stack key={step.id} direction="inline" gap="small" alignItems="center">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={active ? "info" : done || reached ? "success" : "neutral"}>
                {done ? "Done" : step.id}
              </s-badge>
              <s-text type={active ? "strong" : undefined}>{step.label}</s-text>
            </s-stack>
            {index < STEPS.length - 1 ? <s-text color="subdued">/</s-text> : null}
          </s-stack>
        );
      })}
    </s-stack>
  );
}

function ChoiceGroup({ name, label, details, options, value, onChange, error }) {
  return (
    <s-stack gap="small">
      <s-stack gap="none">
        <s-text type="strong">{label}</s-text>
        {details ? <s-text color="subdued">{details}</s-text> : null}
      </s-stack>
      <s-stack direction="inline" gap="small" wrap>
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          const selected = value === optionValue;

          return (
            <s-button
              key={optionValue}
              type="button"
              variant={selected ? "primary" : "secondary"}
              onClick={() => onChange(optionValue)}
            >
              {optionLabel}
            </s-button>
          );
        })}
      </s-stack>
      <input type="hidden" name={name} value={value} />
      {error ? <s-banner tone="critical">{error}</s-banner> : null}
    </s-stack>
  );
}

export default function Onboarding() {
  const { shop, shopInfo, themeEditorUrl } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const maxReached = shop.onboardingStep || 1;
  const [currentStep, setCurrentStep] = useState(
    actionData?.step || shop.onboardingStep || 1,
  );

  const [contactName, setContactName] = useState(shop.contactName || "");
  const [niche, setNiche] = useState(shop.niche || "");
  const [storeName, setStoreName] = useState(shop.storeName || shopInfo.name || "");
  const [currency, setCurrency] = useState(shop.currency || shopInfo.currency || "");
  const [audience, setAudience] = useState(shop.audience || "Everyone");
  const [purchasePurpose, setPurchasePurpose] = useState(
    shop.purchasePurpose || "All kinds of purchases",
  );
  const [budget, setBudget] = useState(shop.budget || "Mixed buyers");
  const [persona, setPersona] = useState(shop.persona || "");
  const [personaEdited, setPersonaEdited] = useState(Boolean(shop.persona));
  const [primaryPrompt, setPrimaryPrompt] = useState(
    shop.primaryPrompt ||
      buildPromptSuggestions(shop.storeName || shopInfo.name, shop.niche)[0],
  );
  const [embedConfirmed, setEmbedConfirmed] = useState(shop.themeEmbedActive);

  const errors = actionData?.errors || {};
  const isSubmitting = navigation.state === "submitting";

  const promptSuggestions = useMemo(
    () => buildPromptSuggestions(storeName || shopInfo.name, niche || shop.niche),
    [storeName, shopInfo.name, niche, shop.niche],
  );

  const regeneratePersona = () => {
    const next = buildPersona({
      storeName: storeName || shopInfo.name,
      audience,
      purchasePurpose,
      budget,
    });
    setPersona(next);
    setPersonaEdited(false);
  };

  useEffect(() => {
    if (!actionData?.ok || !actionData.step) return;
    setCurrentStep(actionData.step);
    if (actionData.scanQueued) {
      shopify.toast.show(
        "First scan queued. Mention rate will build over multiple runs.",
      );
    }
  }, [actionData, shopify]);

  useEffect(() => {
    if (currentStep === 2 && !persona) {
      regeneratePersona();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  return (
    <s-page heading="Citely setup">
      <s-section>
        <s-stack gap="base">
          <s-text color="subdued">
            Get to your first AI visibility check fast. Confirm the store, define the
            buyer, pick the question Citely will track, then turn on storefront
            injection.
          </s-text>
          <ProgressRail currentStep={currentStep} maxReached={maxReached} />
        </s-stack>
      </s-section>

      {currentStep === 1 ? (
        <Form method="post">
          <input type="hidden" name="intent" value="save_step_1" />
          <input type="hidden" name="contactEmail" value={shopInfo.email || ""} />

          <s-section heading="Confirm your store">
            <s-stack gap="base">
              <s-banner tone="info">
                Weekly visibility reports go to {shopInfo.email || "your Shopify account email"}.
                No need to re-enter it.
              </s-banner>

              <s-text-field
                name="contactName"
                label="Your name"
                value={contactName}
                onChange={(event) => setContactName(event.currentTarget.value)}
                details="Used to personalize the dashboard and reports."
                error={errors.contactName}
                autocomplete="name"
              />

              <ChoiceGroup
                name="niche"
                label="Primary niche"
                details="Citely is niche-first. This shapes prompts, compliance tone, and fix recommendations."
                options={NICHES}
                value={niche}
                onChange={setNiche}
                error={errors.niche}
              />
            </s-stack>
          </s-section>

          <s-section heading="Store details from Shopify">
            <s-stack gap="base">
              <s-text-field
                name="storeName"
                label="Store name"
                value={storeName}
                onChange={(event) => setStoreName(event.currentTarget.value)}
                error={errors.storeName}
              />
              <s-text-field
                name="currency"
                label="Currency"
                value={currency}
                onChange={(event) => setCurrency(event.currentTarget.value)}
                details={`Detected domain: ${shopInfo.domain}`}
              />
              <s-paragraph>
                These come from your Shopify shop record. Edit only if something looks wrong.
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base" justifyContent="end">
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                Continue to buyer persona
              </s-button>
            </s-stack>
          </s-section>
        </Form>
      ) : null}

      {currentStep === 2 ? (
        <Form method="post">
          <input type="hidden" name="intent" value="save_step_2" />

          <s-section heading="Build your buyer persona">
            <s-stack gap="large">
              <s-paragraph>
                This is the difference maker. Citely turns your buyer into the real
                questions they ask AI, then tracks mention rate across engines.
              </s-paragraph>

              <ChoiceGroup
                name="audience"
                label="Primary audience"
                details="Who you mostly sell to"
                options={AUDIENCES}
                value={audience}
                onChange={(value) => {
                  setAudience(value);
                  if (!personaEdited) {
                    setPersona(
                      buildPersona({
                        storeName: storeName || shopInfo.name,
                        audience: value,
                        purchasePurpose,
                        budget,
                      }),
                    );
                  }
                }}
                error={errors.audience}
              />

              <ChoiceGroup
                name="purchasePurpose"
                label="Purchase purpose"
                details="What they usually buy for"
                options={PURPOSES}
                value={purchasePurpose}
                onChange={(value) => {
                  setPurchasePurpose(value);
                  if (!personaEdited) {
                    setPersona(
                      buildPersona({
                        storeName: storeName || shopInfo.name,
                        audience,
                        purchasePurpose: value,
                        budget,
                      }),
                    );
                  }
                }}
                error={errors.purchasePurpose}
              />

              <ChoiceGroup
                name="budget"
                label="Typical budget"
                details="How your buyers tend to spend"
                options={BUDGETS}
                value={budget}
                onChange={(value) => {
                  setBudget(value);
                  if (!personaEdited) {
                    setPersona(
                      buildPersona({
                        storeName: storeName || shopInfo.name,
                        audience,
                        purchasePurpose,
                        budget: value,
                      }),
                    );
                  }
                }}
                error={errors.budget}
              />

              <s-stack gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text type="strong">Buyer persona</s-text>
                  <s-badge>Generated</s-badge>
                </s-stack>
                <s-text-area
                  name="persona"
                  label="Persona summary"
                  value={persona}
                  onChange={(event) => {
                    setPersona(event.currentTarget.value);
                    setPersonaEdited(true);
                  }}
                  rows={5}
                  error={errors.persona}
                />
                <s-stack direction="inline" gap="small">
                  <s-button type="button" variant="secondary" onClick={regeneratePersona}>
                    Regenerate persona
                  </s-button>
                </s-stack>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base" justifyContent="space-between">
              <s-button type="button" variant="tertiary" onClick={() => setCurrentStep(1)}>
                Back
              </s-button>
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                Continue to first scan
              </s-button>
            </s-stack>
          </s-section>
        </Form>
      ) : null}

      {currentStep === 3 ? (
        <Form method="post">
          <input type="hidden" name="intent" value="save_step_3" />

          <s-section heading="Set your first AI visibility scan">
            <s-stack gap="base">
              <s-paragraph>
                Citely will ask ChatGPT, Perplexity, Gemini, and other engines this
                buying question on a schedule. We report mention frequency over many
                runs, never a one-shot yes or no.
              </s-paragraph>

              <s-text-area
                name="primaryPrompt"
                label="Primary buying question"
                value={primaryPrompt}
                onChange={(event) => setPrimaryPrompt(event.currentTarget.value)}
                rows={3}
                error={errors.primaryPrompt}
                details="Write it the way a real shopper would ask an AI assistant."
              />

              <s-stack gap="small">
                <s-text type="strong">Quick starters</s-text>
                <s-stack gap="small">
                  {promptSuggestions.map((suggestion) => (
                    <s-button
                      key={suggestion}
                      type="button"
                      variant="secondary"
                      onClick={() => setPrimaryPrompt(suggestion)}
                    >
                      {suggestion}
                    </s-button>
                  ))}
                </s-stack>
              </s-stack>

              <s-banner tone="info">
                Your first scan is queued after this step. Results improve as Citely
                collects more runs, then we suggest schema, llms.txt, and content fixes.
              </s-banner>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base" justifyContent="space-between">
              <s-button type="button" variant="tertiary" onClick={() => setCurrentStep(2)}>
                Back
              </s-button>
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                Queue first scan
              </s-button>
            </s-stack>
          </s-section>
        </Form>
      ) : null}

      {currentStep === 4 ? (
        <Form method="post">
          <input type="hidden" name="intent" value="complete_onboarding" />
          <input
            type="hidden"
            name="themeEmbedActive"
            value={embedConfirmed ? "true" : "false"}
          />

          <s-section heading="Turn Citely on for your storefront">
            <s-stack gap="large">
              <s-paragraph>
                Enable the Citely app embed so we can inject AI-readable product schema
                and help publish discovery files. This is what lets Check turn into Fix.
              </s-paragraph>

              <s-box padding="base" border="base" borderRadius="base">
                <s-stack gap="base">
                  <s-text type="strong">1. Open the theme editor</s-text>
                  <s-paragraph>
                    Go to App embeds, toggle on Citely schema injection, then save.
                  </s-paragraph>
                  <s-button href={themeEditorUrl} target="_top" variant="primary">
                    Open theme editor
                  </s-button>
                </s-stack>
              </s-box>

              <s-box padding="base" border="base" borderRadius="base">
                <s-stack gap="base">
                  <s-text type="strong">2. Confirm the embed</s-text>
                  <s-paragraph>
                    After you save in the theme editor, confirm here so Citely can start
                    the fix loop. You can finish now and enable the embed later.
                  </s-paragraph>
                  <s-checkbox
                    label="I enabled the Citely app embed"
                    checked={embedConfirmed}
                    onChange={(event) =>
                      setEmbedConfirmed(Boolean(event.currentTarget.checked))
                    }
                  />
                </s-stack>
              </s-box>

              <s-banner>
                Citely never promises rankings. You get clearer mention data, practical
                fixes, and AI-attributed revenue tracking as a floor, not an exact science.
              </s-banner>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base" justifyContent="space-between">
              <s-button type="button" variant="tertiary" onClick={() => setCurrentStep(3)}>
                Back
              </s-button>
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                {embedConfirmed ? "Finish setup" : "Finish and enable embed later"}
              </s-button>
            </s-stack>
          </s-section>
        </Form>
      ) : null}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
