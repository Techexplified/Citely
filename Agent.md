Do not add emojis
do not use dashes between content and words
always double check your response and code for error and functionality
do not add anything until it is asked for

# Citely

Shopify app for AI search visibility and AI-attributed sales.
Core loop: check (am I mentioned by AI) -> fix (schema, llms.txt, rewrites) -> prove (orders from AI referrers).

## Product

Niche / vertical first (e.g. supplements), outcome led (dollars and mention rate), not a generic score dashboard.
Competitors do visibility score + fix + AI order tracking. Citely differentiates with accurate prompt tracking and niche content quality.

CHECK: Vercel cron -> queue/worker (store x prompt x engine) -> GPT / Perplexity / Gemini -> parse mention rate and competitors -> Postgres dashboard.
PROVE: AI referrer land -> theme pixel stamps cart attribute -> orders/create webhook (dedupe) -> revenue by engine.
FIX LOOP: dashboard insights -> schema / llms.txt / rewrites on store -> re-scan.

## Stack

React Router Shopify app template, Polaris + App Bridge, Shopify GraphQL Admin API + webhooks.
Hosted Postgres (Neon preferred over template SQLite for Vercel).
Vercel for admin + webhooks. Long AI scan jobs need queue/worker (not raw Vercel function limits).
Theme App Extension (`extensions/citely-theme`) app embed for JSON-LD / FAQ injection and AI referrer cart stamping. App Proxy for store-domain llms.txt.
AI attribution: pixel + cart attributes + orders/create; treat attribution as a floor not exact.
OpenRouter via OPENROUTER_API_KEY in .env for multi-engine scans (ChatGPT, Gemini, Perplexity). Optional OPENROUTER_MODELS JSON override.

## Hard constraints

Show mention frequency over many runs, never yes/no from one AI answer.
Cap prompt volume per plan (LLM cost). Queue with retry/backoff for Shopify and LLM rate limits.
Webhooks must be idempotent. Uninstall must stop billing, delete data, remove injected store code.
Required GDPR webhooks for App Store: customers/data_request, customers/redact, shop/redact.
Respect niche compliance (e.g. supplement claim limits). Test theme injection on popular themes.
Do not promise rankings; promise better data and fixes.
