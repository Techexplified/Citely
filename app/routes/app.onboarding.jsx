import { useEffect, useMemo, useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  Pill,
  Sparkles,
  Shirt,
  House,
  UtensilsCrossed,
  PawPrint,
  Shapes,
  User,
  Users,
  Building2,
  Globe,
  ShoppingBag,
  Home,
  Gift,
  Briefcase,
  Repeat,
  Wallet,
  Scale,
  Gem,
  Shuffle,
  Mail,
  Store,
  Clipboard,
  Target,
  Scan,
  Rocket,
  Lightbulb,
  Zap,
  Clock3,
  RefreshCw,
  Info,
} from "lucide-react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  ensurePrimaryPrompt,
  ensureShop,
  upsertShopProfile,
} from "../models/shop.server";
import { runShopScan } from "../services/scan.server";
import { getThemeEmbedEditorUrl } from "../utils/theme.server";

const STEPS = [
  { id: 1, label: "Store" },
  { id: 2, label: "Persona" },
  { id: 3, label: "First scan" },
  { id: 4, label: "Activate" },
];

const NICHES = [
  { value: "supplements", label: "Supplements & wellness", icon: Pill },
  { value: "beauty", label: "Beauty & skincare", icon: Sparkles },
  { value: "fashion", label: "Fashion & apparel", icon: Shirt },
  { value: "home", label: "Home & lifestyle", icon: House },
  { value: "food", label: "Food & beverage", icon: UtensilsCrossed },
  { value: "pets", label: "Pets", icon: PawPrint },
  { value: "other", label: "Other niche", icon: Shapes },
];

const AUDIENCES = [
  { value: "Men", icon: User },
  { value: "Women", icon: Users },
  { value: "Businesses", icon: Building2 },
  { value: "Everyone", icon: Globe },
];

const PURPOSES = [
  { value: "Personal / everyday use", icon: ShoppingBag },
  { value: "Family or household", icon: Home },
  { value: "Gifts & occasions", icon: Gift },
  { value: "Work / professional", icon: Briefcase },
  { value: "All kinds of purchases", icon: Repeat },
];

const BUDGETS = [
  { value: "Budget-conscious", icon: Wallet },
  { value: "Mid-range", icon: Scale },
  { value: "Premium", icon: Gem },
  { value: "Mixed buyers", icon: Shuffle },
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
    themeEditorUrl: getThemeEmbedEditorUrl(shopDomain),
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
    if (!contactName)
      errors.contactName = "Enter your name so reports feel personal.";
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
    const purchasePurpose = String(
      formData.get("purchasePurpose") || "",
    ).trim();
    const budget = String(formData.get("budget") || "").trim();
    const persona = String(formData.get("persona") || "").trim();
    const storeName = existing.storeName || shopDomain;

    const errors = {};
    if (!audience) errors.audience = "Select who you mostly sell to.";
    if (!purchasePurpose)
      errors.purchasePurpose = "Select why customers usually buy.";
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

    const shopAfterPrompt = await upsertShopProfile(shopDomain, {
      primaryPrompt,
      onboardingStep: Math.max(existing.onboardingStep, 4),
    });
    await ensurePrimaryPrompt(shopAfterPrompt);

    const scan = await runShopScan(shopAfterPrompt);

    return {
      ok: true,
      step: 4,
      scanQueued: Boolean(scan?.ok),
      scanError: scan?.ok ? null : scan?.error || "Scan failed",
    };
  }

  if (intent === "complete_onboarding") {
    const themeEmbedActive = formData.get("themeEmbedActive") === "true";

    const shopAfterComplete = await upsertShopProfile(shopDomain, {
      themeEmbedActive,
      onboardingStep: 4,
      onboardingDone: true,
    });
    await ensurePrimaryPrompt(shopAfterComplete);

    return redirect("/app");
  }

  if (intent === "go_step") {
    const step = Number(formData.get("step") || 1);
    const allowed = Math.min(Math.max(step, 1), existing.onboardingStep);
    return { ok: true, step: allowed };
  }

  return {
    ok: false,
    errors: { form: "Unknown action." },
    step: existing.onboardingStep,
  };
};

/* ---------- Visual primitives (plain elements — free to theme) ---------- */

function OnboardingStyles() {
  return (
    <style>{`
      .co-wrap {
        --co-ink: #111111;
        --co-muted: #6b7280;
        --co-border: #e5e7eb;
        --co-soft: #f3f4f6;
        --co-card: #ffffff;
        --co-canvas: #f4f4f5;
        --co-shadow: 0 1px 2px rgba(17, 17, 17, 0.04), 0 8px 24px rgba(17, 17, 17, 0.04);
        display: block;
        color: var(--co-ink);
      }

      .co-hero {
        border-radius: 14px;
        padding: 20px 24px;
        margin-bottom: 4px;
        background: var(--co-ink);
        color: #fff;
        box-shadow: var(--co-shadow);
      }
      .co-hero__badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .02em;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.18);
        padding: 4px 10px;
        border-radius: 999px;
        margin-bottom: 8px;
      }
      .co-hero__text {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        color: rgba(255,255,255,0.82);
        max-width: 720px;
      }

      .co-stepper-card {
        background: var(--co-card);
        border: 1px solid var(--co-border);
        border-radius: 14px;
        padding: 16px 20px;
        margin-top: 14px;
        box-shadow: var(--co-shadow);
      }
      .co-stepper { display: flex; align-items: center; }
      .co-step { display: flex; align-items: center; }
      .co-step__circle {
        width: 30px; height: 30px; border-radius: 999px;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 700; flex-shrink: 0;
        transition: all .2s ease;
      }
      .co-step__circle--done { background: var(--co-ink); color: #fff; }
      .co-step__circle--active {
        background: #fff; border: 2px solid var(--co-ink); color: var(--co-ink);
      }
      .co-step__circle--reached {
        background: var(--co-soft); color: var(--co-ink); border: 1px solid var(--co-border);
      }
      .co-step__circle--upcoming { background: var(--co-soft); color: #9ca3af; }
      .co-step__label {
        margin-left: 8px; font-size: 13px; font-weight: 600;
        color: var(--co-muted); white-space: nowrap;
      }
      .co-step__label--active, .co-step__label--done { color: var(--co-ink); }
      .co-step__line {
        width: 40px; height: 2px; margin: 0 14px;
        background: var(--co-border); border-radius: 2px;
      }
      .co-step__line--done { background: var(--co-ink); }

      .co-section-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 4px; }
      .co-section-icon {
        width: 34px; height: 34px; border-radius: 10px;
        background: var(--co-soft); border: 1px solid var(--co-border);
        display: flex; align-items: center; justify-content: center;
        font-size: 17px; flex-shrink: 0; color: var(--co-ink);
      }
      .co-section-title { font-size: 15px; font-weight: 700; color: var(--co-ink); }
      .co-section-subtitle { font-size: 13px; color: var(--co-muted); margin-top: 1px; }
      .co-section-body { margin-top: 14px; }

      .co-chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
      .co-chip {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px; border-radius: 999px;
        border: 1.5px solid var(--co-border); background: #fff;
        color: #374151; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: all .15s ease;
      }
      .co-chip:hover { border-color: #111111; background: var(--co-soft); }
      .co-chip--selected {
        background: var(--co-ink); border-color: var(--co-ink); color: #fff;
        box-shadow: none;
      }
      .co-chip--selected:hover { background: var(--co-ink); }
      .co-chip__icon { font-size: 14px; line-height: 1; display: inline-flex; }
      .co-field-label { font-size: 13px; font-weight: 700; color: var(--co-ink); margin-bottom: 2px; }
      .co-field-hint { font-size: 12px; color: var(--co-muted); margin-bottom: 8px; }
      .co-error-text { font-size: 12px; color: #ef4444; font-weight: 600; margin-top: 6px; }

      .co-persona-card {
        border: 1px solid var(--co-border);
        border-left: 4px solid var(--co-ink);
        background: #fff;
        border-radius: 12px; padding: 16px;
      }
      .co-persona-card__head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .co-persona-card__title { font-size: 14px; font-weight: 700; color: var(--co-ink); }
      .co-persona-card__badge {
        font-size: 11px; font-weight: 700; color: #fff;
        background: var(--co-ink); padding: 2px 10px; border-radius: 999px;
      }

      .co-nav-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .co-btn {
        border: 1px solid var(--co-ink); border-radius: 999px;
        padding: 10px 16px; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: all .15s ease;
        display: inline-flex; align-items: center; gap: 8px; line-height: 1;
      }
      .co-btn--primary { background: var(--co-ink); color: #fff; box-shadow: none; }
      .co-btn--primary:hover { opacity: 0.92; }
      .co-btn--primary:disabled { opacity: .55; cursor: default; }
      .co-btn--ghost {
        background: transparent; border-color: transparent;
        color: var(--co-muted); padding: 10px 12px;
      }
      .co-btn--ghost:hover { color: var(--co-ink); }

      .co-embed-card {
        border: 1px solid var(--co-border); border-radius: 12px;
        padding: 16px; background: #fff; transition: box-shadow .15s ease;
      }
      .co-embed-card:hover { box-shadow: var(--co-shadow); }
      .co-embed-card__num {
        width: 26px; height: 26px; border-radius: 999px;
        background: var(--co-ink); color: #fff;
        font-size: 12px; font-weight: 800;
        display: inline-flex; align-items: center; justify-content: center;
        margin-right: 8px; flex-shrink: 0;
      }
      .co-embed-card__head { display: flex; align-items: center; margin-bottom: 6px; }
      .co-embed-card__title { font-size: 14px; font-weight: 700; color: var(--co-ink); }

      .co-toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
      .co-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
      .co-toggle__track {
        width: 40px; height: 22px; border-radius: 999px;
        background: #d1d5db; position: relative;
        transition: background .15s ease; flex-shrink: 0;
      }
      .co-toggle__thumb {
        position: absolute; top: 2px; left: 2px;
        width: 18px; height: 18px; border-radius: 999px;
        background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        transition: transform .15s ease;
      }
      .co-toggle input:checked + .co-toggle__track { background: var(--co-ink); }
      .co-toggle input:checked + .co-toggle__track .co-toggle__thumb { transform: translateX(18px); }
      .co-toggle__label { font-size: 13px; font-weight: 600; color: var(--co-ink); }

      .co-banner {
        border-radius: 10px; padding: 12px 14px; font-size: 13px;
        line-height: 1.5; display: flex; gap: 10px; align-items: flex-start;
      }
      .co-banner--info {
        background: var(--co-soft); color: var(--co-ink);
        border: 1px solid var(--co-border);
      }
      .co-banner--soft {
        background: #fff; color: var(--co-muted);
        border: 1px solid var(--co-border);
      }
      .co-banner svg { color: var(--co-ink); flex-shrink: 0; margin-top: 1px; }
    `}</style>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8.5L6.2 11.7L13 4.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Stepper({ currentStep, maxReached }) {
  return (
    <div className="co-stepper-card">
      <div className="co-stepper">
        {STEPS.map((step, index) => {
          const reached = step.id <= maxReached;
          const active = step.id === currentStep;
          const done = step.id < currentStep;
          const status = done
            ? "done"
            : active
              ? "active"
              : reached
                ? "reached"
                : "upcoming";

          return (
            <div className="co-step" key={step.id}>
              <div className={`co-step__circle co-step__circle--${status}`}>
                {done ? <CheckIcon /> : step.id}
              </div>
              <span className={`co-step__label co-step__label--${status}`}>
                {step.label}
              </span>
              {index < STEPS.length - 1 ? (
                <div
                  className={`co-step__line ${done ? "co-step__line--done" : ""}`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ icon: Icon, label, selected, onClick }) {
  return (
    <button
      type="button"
      className={`co-chip ${selected ? "co-chip--selected" : ""}`}
      onClick={onClick}
    >
      {Icon ? (
        <span className="co-chip__icon">
          <Icon size={16} strokeWidth={2} />
        </span>
      ) : null}
      <span>{label}</span>
    </button>
  );
}

function ChoiceGroup({
  name,
  label,
  details,
  options,
  value,
  onChange,
  error,
}) {
  return (
    <div>
      <div className="co-field-label">{label}</div>
      {details ? <div className="co-field-hint">{details}</div> : null}
      <div className="co-chip-group">
        {options.map((option) => {
          const optionValue =
            typeof option === "string" ? option : option.value;
          const optionLabel =
            typeof option === "string" ? option : option.label || option.value;
          const optionIcon = typeof option === "string" ? null : option.icon;
          const selected = value === optionValue;

          return (
            <Chip
              key={optionValue}
              icon={optionIcon}
              label={optionLabel}
              selected={selected}
              onClick={() => onChange(optionValue)}
            />
          );
        })}
      </div>
      <input type="hidden" name={name} value={value} />
      {error ? <div className="co-error-text">{error}</div> : null}
    </div>
  );
}

function SectionCard({ icon: Icon, title, subtitle, children }) {
  return (
    <s-section>
      <div className="co-section-head">
        {Icon ? (
          <div className="co-section-icon">
            <Icon size={20} strokeWidth={2} />
          </div>
        ) : null}

        <div>
          <div className="co-section-title">{title}</div>
          {subtitle ? (
            <div className="co-section-subtitle">{subtitle}</div>
          ) : null}
        </div>
      </div>

      <div className="co-section-body">{children}</div>
    </s-section>
  );
}

function NavRow({
  onBack,
  backLabel = "Back",
  primaryLabel,
  submitting,
  align = "space-between",
}) {
  return (
    <s-section>
      <div
        className="co-nav-row"
        style={align === "end" ? { justifyContent: "flex-end" } : undefined}
      >
        {onBack ? (
          <button
            type="button"
            className="co-btn co-btn--ghost"
            onClick={onBack}
          >
            ← {backLabel}
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          className="co-btn co-btn--primary"
          disabled={submitting}
        >
          {submitting ? "Saving…" : primaryLabel}
        </button>
      </div>
    </s-section>
  );
}

/* ---------------------------------------------------------------------- */

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
  const [storeName, setStoreName] = useState(
    shop.storeName || shopInfo.name || "",
  );
  const [currency, setCurrency] = useState(
    shop.currency || shopInfo.currency || "",
  );
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
    () =>
      buildPromptSuggestions(storeName || shopInfo.name, niche || shop.niche),
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
        "First scan complete. Mention rate will build over multiple runs.",
      );
    } else if (actionData.scanError) {
      shopify.toast.show(actionData.scanError);
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
      <OnboardingStyles />
      <div className="co-wrap">
        <s-section>
          <div className="co-hero">
            <div className="co-hero__badge">
              <Sparkles size={16} strokeWidth={2} />
              <span>AI Visibility Setup</span>
            </div>

            <p className="co-hero__text">
              Get to your first AI visibility check fast. Confirm the store,
              define the buyer, pick the question Citely will track, then turn
              on storefront injection.
            </p>
          </div>

          <Stepper currentStep={currentStep} maxReached={maxReached} />
        </s-section>

        {currentStep === 1 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="save_step_1" />
            <input
              type="hidden"
              name="contactEmail"
              value={shopInfo.email || ""}
            />

            <SectionCard
              icon={Store}
              title="Confirm your store"
              subtitle="A few basics so reports and prompts feel right for your shop."
            >
              <s-stack gap="base">
                <div className="co-banner co-banner--info">
                  <Mail size={18} strokeWidth={2} />
                  <span>
                    Weekly visibility reports go to{" "}
                    {shopInfo.email || "your Shopify account email"}. No need to
                    re-enter it.
                  </span>
                </div>

                <s-text-field
                  name="contactName"
                  label="Your name"
                  value={contactName}
                  onChange={(event) =>
                    setContactName(event.currentTarget.value)
                  }
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
            </SectionCard>

            <SectionCard
              icon={Clipboard}
              title="Store details from Shopify"
              subtitle="Pulled from your Shopify shop record."
            >
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
                <div className="co-banner co-banner--soft">
                  <Info size={18} strokeWidth={2} />
                  <span>
                    These come from your Shopify shop record. Edit only if
                    something looks wrong.
                  </span>
                </div>
              </s-stack>
            </SectionCard>

            <NavRow
              primaryLabel="Continue to buyer persona"
              submitting={isSubmitting}
              align="end"
            />
          </Form>
        ) : null}

        {currentStep === 2 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="save_step_2" />

            <SectionCard
              icon={Target}
              title="Build your buyer persona"
              subtitle="This is the difference maker. Citely turns your buyer into the real questions they ask AI, then tracks mention rate across engines."
            >
              <s-stack gap="large">
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

                <div className="co-persona-card">
                  <div className="co-persona-card__head">
                    <span className="co-persona-card__title">
                      Buyer persona
                    </span>
                    <span className="co-persona-card__badge">Generated</span>
                  </div>
                  <s-text-area
                    name="persona"
                    label="Persona summary"
                    labelAccessibilityVisibility="exclusive"
                    value={persona}
                    onChange={(event) => {
                      setPersona(event.currentTarget.value);
                      setPersonaEdited(true);
                    }}
                    rows={5}
                    error={errors.persona}
                  />
                  <div style={{ marginTop: "10px" }}>
                    <button
                      type="button"
                      className="co-btn co-btn--ghost"
                      onClick={regeneratePersona}
                      style={{
                        padding: "8px 12px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <RefreshCw size={16} strokeWidth={2} />
                      <span>Regenerate persona</span>
                    </button>
                  </div>
                </div>
              </s-stack>
            </SectionCard>

            <NavRow
              onBack={() => setCurrentStep(1)}
              primaryLabel="Continue to first scan"
              submitting={isSubmitting}
            />
          </Form>
        ) : null}

        {currentStep === 3 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="save_step_3" />

            <SectionCard
              icon={Scan}
              title="Set your first AI visibility scan"
              subtitle="Citely asks ChatGPT, Perplexity, Gemini and others this question on a schedule and reports mention frequency over many runs — never a one-shot yes or no."
            >
              <s-stack gap="base">
                <s-text-area
                  name="primaryPrompt"
                  label="Primary buying question"
                  value={primaryPrompt}
                  onChange={(event) =>
                    setPrimaryPrompt(event.currentTarget.value)
                  }
                  rows={3}
                  error={errors.primaryPrompt}
                  details="Write it the way a real shopper would ask an AI assistant."
                />

                <div>
                  <div
                    className="co-field-label"
                    style={{
                      marginBottom: "8px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Zap size={16} strokeWidth={2} />
                    <span>Quick starters</span>
                  </div>

                  <s-stack gap="small-200">
                    {promptSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="co-chip"
                        style={{
                          borderRadius: "10px",
                          justifyContent: "flex-start",
                          textAlign: "left",
                        }}
                        onClick={() => setPrimaryPrompt(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </s-stack>
                </div>

                <div className="co-banner co-banner--info">
                  <Clock3 size={18} strokeWidth={2} />
                  <span>
                    Your first scan is queued after this step. Results improve
                    as Citely collects more runs, then we suggest store and
                    content fixes.
                  </span>
                </div>
              </s-stack>
            </SectionCard>

            <NavRow
              onBack={() => setCurrentStep(2)}
              primaryLabel="Queue first scan"
              submitting={isSubmitting}
            />
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

            <SectionCard
              icon={Rocket}
              title="Turn Citely on for your storefront"
              subtitle="Enable the Citely app embed so we can inject AI-readable product schema and help publish discovery files. This is what lets Check turn into Fix."
            >
              <s-stack gap="large">
                <div className="co-embed-card">
                  <div className="co-embed-card__head">
                    <span className="co-embed-card__num">1</span>
                    <span className="co-embed-card__title">
                      Open the theme editor
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#6b7280",
                      margin: "0 0 12px 34px",
                    }}
                  >
                    Go to App embeds, toggle on Citely schema injection, then
                    save.
                  </p>
                  <div style={{ marginLeft: "34px" }}>
                    <a
                      href={themeEditorUrl}
                      target="_top"
                      className="co-btn co-btn--primary"
                      style={{ textDecoration: "none" }}
                    >
                      Open theme editor →
                    </a>
                  </div>
                </div>

                <div className="co-embed-card">
                  <div className="co-embed-card__head">
                    <span className="co-embed-card__num">2</span>
                    <span className="co-embed-card__title">
                      Confirm the embed
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#6b7280",
                      margin: "0 0 12px 34px",
                    }}
                  >
                    After you save in the theme editor, confirm here so Citely
                    can start the fix loop. You can finish now and enable the
                    embed later.
                  </p>
                  <div style={{ marginLeft: "34px" }}>
                    <label className="co-toggle">
                      <input
                        type="checkbox"
                        checked={embedConfirmed}
                        onChange={(event) =>
                          setEmbedConfirmed(
                            Boolean(event.currentTarget.checked),
                          )
                        }
                      />
                      <span className="co-toggle__track">
                        <span className="co-toggle__thumb" />
                      </span>
                      <span className="co-toggle__label">
                        I enabled the Citely app embed
                      </span>
                    </label>
                  </div>
                </div>

                <div className="co-banner co-banner--soft">
                  <Lightbulb size={18} strokeWidth={2} />
                  <span>
                    Citely never promises rankings. You get clearer mention
                    data, practical fixes, and AI-attributed revenue tracking as
                    a floor, not an exact science.
                  </span>
                </div>
              </s-stack>
            </SectionCard>

            <NavRow
              onBack={() => setCurrentStep(3)}
              primaryLabel={
                embedConfirmed
                  ? "Finish setup"
                  : "Finish and enable embed later"
              }
              submitting={isSubmitting}
            />
          </Form>
        ) : null}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
