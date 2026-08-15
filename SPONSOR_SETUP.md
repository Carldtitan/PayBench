# Sponsor setup and revenue-first plan

The local tooling is installed, but account creation, identity checks, billing
activation, phone-number provisioning, and OAuth consent must be completed by
the account owner. Keep event redemption links and promo codes in `Notion.md`
or another private location; do not copy them into a public repository.

## What is already installed

| Service | Sponsor status | Local status |
| --- | --- | --- |
| Terac | Required hackathon sponsor | Remote MCP endpoint added to Codex; login still required |
| Stripe | Sponsor and revenue path | Codex plugin and official best-practices skill installed |
| Linq | Sponsor and messaging track | Codex plugin, MCP, CLI, and four official skills installed |
| Replay | Sponsor and QA track | Codex plugin, CLI, and four official skills installed |
| Superserve | Sponsor and sandbox track | CLI and official skill installed |
| Pioneer | Optional sponsor | No trustworthy official skill/MCP found; use its REST/OpenAI-compatible API |
| Render | Optional sponsor | Codex plugin installed; account connection still required |
| OpenAI/PostHog | Not sponsors | Optional model fallback and conversion analytics only |

New skills become available after restarting or reloading Codex.

## What you must do

### 1. Create the private environment file

From this directory:

```powershell
Copy-Item .env.example .env
```

Fill `.env`, never `.env.example`. The `.gitignore` already excludes `.env`.
An app may load `.env`, but Codex MCP authentication reads the environment of
the Codex process or its own OAuth store. Restart Codex after changing shell
environment variables.

### 2. Authorize Terac

1. Use the event redemption link in `Notion.md`, create a Terac organization,
   and ensure it has study credit.
2. Run `codex mcp login terac` and complete the browser login. For unattended
   automation, create a `tk_` API key in organization settings and put it only
   in `.env` or a secrets manager.
3. Ask Codex to use Terac to get the organization context. A successful response
   should show the organization and credit balance.
4. Launch studies to the general population for the fastest response, and retain
   the before/after evidence showing that human input improved the product.

### 3. Activate real Stripe revenue

1. Create or activate the team member's Stripe account and complete any checks
   Stripe requires for live payments.
2. Create one live Payment Link in the dashboard. A fixed low-cost offer is
   easiest to explain and measure; "customer chooses price" is useful only if
   the product is genuinely pay-what-you-want.
3. Put the same URL in `STRIPE_PAYMENT_LINK_URL`. The hackathon brief says to use
   the submitted link for every transaction so revenue tracking does not miss it.
4. After the app is publicly deployed, create a webhook endpoint and put its
   signing secret in `STRIPE_WEBHOOK_SECRET`. Treat `checkout.session.completed`
   as the fulfillment signal, with idempotency protection.
5. Separately create the organizer-facing restricted key with read-only access
   to Balance and Charges. Submit it through the organizer's requested channel;
   do not place it in the app or commit it.

No local setup can perform account verification or create real customer demand.
Revenue requires a clear offer, an actual consenting buyer, live-mode Checkout,
and fulfillment after payment.

### 4. Activate Linq

1. Use the hackathon signup route from `Notion.md`, choose **Hackathon** as the
   referral source, obtain a V3 bearer token, and provision at least one number.
2. Run `linq login --token <your-token>`. This stores the credential in the
   user's Linq config instead of the repository.
3. Put the token in `LINQ_API_KEY` and `LINQ_API_V3_API_KEY` only when the running
   app or headless automation needs environment-based access.
4. Create the deployed webhook subscription, save its one-time signing secret
   as `LINQ_WEBHOOK_SECRET`, and verify signatures using the raw request body.
5. Honor opt-outs immediately. Do not cold-blast a purchased list. Linq should
   carry a real conversation and deliver the Stripe Payment Link when the user
   chooses to buy.

### 5. Activate Replay

1. Sign up through the Replay QA site and apply the private event code listed in
   `Notion.md`.
2. Create a Replay API key and put it in `REPLAY_API_KEY`. If Replay QA gives you
   a separate `lqa_` token, put it in `REPLAY_QA_API_TOKEN`.
3. Deploy the app, set `REPLAY_TARGET_URL`, and ask Codex to run the Replay QA
   loop. Publish browser source maps so reports point to the original files.
4. Fix reported bugs until the project receives a clean report for the track.

### 6. Activate Superserve

1. Sign up at the Superserve link in `Notion.md`; the brief says no payment
   method is required.
2. Generate an API key and put it in `SUPERSERVE_API_KEY`.
3. Use Superserve for an essential agent execution step, not a decorative demo.
   Good candidates are paid-job fulfillment, isolated customer-data processing,
   or a persistent agent that resumes work after payment.

### 7. Optional Pioneer and Render

- Pioneer is a sponsor. Redeem its event offer privately, create a `pio_sk_` key,
  and use `https://api.pioneer.ai/v1` through an OpenAI-compatible client. Use it
  only if it improves cost, latency, or eligibility without delaying sales.
- Render is also a sponsor. It is a sensible deployment choice because Stripe,
  Linq, and Replay all need a public URL. Its prize specifically requires Render
  Workflows, so ordinary web hosting alone is not enough for that track.

## Revenue-first system flow

1. Use Terac to test the offer, price, and message with real people.
2. Start consent-based conversations through Linq.
3. Send the single Stripe Payment Link after purchase intent is clear.
4. Confirm payment with the Stripe webhook, then fulfill the paid job in a
   Superserve sandbox.
5. Use Replay to keep the acquisition, payment, and fulfillment path working.
6. Feed conversion objections and fulfillment ratings back into a second Terac
   study to demonstrate measurable improvement.

Do not add more services unless they shorten this path. PostHog is a non-sponsor
and can help measure the funnel, but Stripe's completed payments remain the
revenue source of truth.
