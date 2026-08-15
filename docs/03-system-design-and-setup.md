# PayBench system design and setup

## Architecture decision

PayBench uses five runtime parts.

| Part | Choice | Purpose |
| --- | --- | --- |
| Web app and API | Next.js with TypeScript on Vercel | Intake, reports, Stripe and Linq webhooks, and study telemetry |
| Database and storage | Supabase | Durable workflow state, memory, behavior events, screenshots, and reports |
| Worker | Superserve | Browser capture, specification extraction, page rendering, and isolated execution |
| Model | OpenAI multimodal model | Structured page understanding and constrained change planning |
| Human testing | Terac | Scout fallback and participant evaluation |

Supabase, OpenAI, and Vercel are not hackathon sponsors. They are required infrastructure. The sponsor products remain visible in the core path.

## Runtime flow

```text
Linq inbound message
        |
        v
Next.js API -----> Supabase job + conversation memory
        |
        v
Stripe Payment Link -----> signed Stripe webhook
        |
        v
Superserve worker <-----> Supabase artifacts and workflow state
        |
        +-----> Terac scout fallback
        +-----> A/B preview URLs -----> Terac participants
        +-----> Replay QA
        |
        v
Report in Supabase -----> Linq delivery
```

## Supabase data model

### `customers`

- `id`
- `linq_handle_hash`
- `stripe_email_hash`
- `created_at`
- `last_active_at`
- `opt_out_status`

Do not store a phone number in clear text unless the Linq integration requires it. Encrypt or hash stable identifiers.

### `conversations`

- `id`
- `customer_id`
- `linq_chat_id`
- `state`
- `last_inbound_at`
- `last_outbound_at`

### `jobs`

- `id`
- `customer_id`
- `submitted_url`
- `normalized_url`
- `status`
- `payment_status`
- `stripe_checkout_session_id`
- `superserve_sandbox_id`
- `capture_confidence`
- `failure_code`
- `created_at`
- `updated_at`

### `website_captures`

- `id`
- `job_id`
- `final_url`
- `captured_at`
- `desktop_screenshot_path`
- `mobile_screenshot_path`
- `dom_path`
- `console_log_path`
- `checksum`

### `paywall_specs`

- `id`
- `job_id`
- `version`
- `spec_json`
- `source_evidence_json`
- `confidence`
- `created_at`

### `variants`

- `id`
- `job_id`
- `label`
- `hypothesis`
- `component_tree_json`
- `screenshot_path`
- `preview_path`
- `quality_status`

### `studies`

- `id`
- `job_id`
- `terac_study_id`
- `target_sample_size`
- `status`
- `started_at`
- `completed_at`

### `participant_sessions`

- `id`
- `study_id`
- `participant_token_hash`
- `assigned_order`
- `quality_status`
- `started_at`
- `completed_at`

### `behavior_events`

- `id`
- `participant_session_id`
- `variant_id`
- `event_name`
- `event_time`
- `element_key`
- `metadata_json`

### `participant_feedback`

- `id`
- `participant_session_id`
- `variant_id`
- `clarity_score`
- `trust_score`
- `purchase_confidence_score`
- `reason_text`

### `reports`

- `id`
- `job_id`
- `result`
- `metrics_json`
- `report_path`
- `public_token_hash`
- `expires_at`

### `agent_runs`

- `id`
- `job_id`
- `stage`
- `model`
- `input_artifact_paths`
- `output_artifact_path`
- `prompt_version`
- `status`
- `error_code`
- `started_at`
- `completed_at`

### `webhook_events`

- `provider`
- `external_event_id`
- `received_at`
- `processed_at`
- `status`

Use a unique constraint on `(provider, external_event_id)`. This makes Stripe and Linq webhook handling idempotent.

## What memory means

PayBench does not depend on a long chat transcript as memory.

### Workflow memory

The `jobs.status` field is the source of truth. Valid states are:

```text
awaiting_confirmation
awaiting_payment
paid
capturing
needs_scout
spec_ready
building_variants
quality_check
recruiting
testing
analyzing
replay_qa
report_ready
delivered
failed
```

Each transition records time, actor, and reason. A worker can restart from the last completed stage.

### Brand memory

The latest approved `PaywallSpec` stores the brand, offer, page structure, and source evidence. A retry loads this specification instead of re-scraping everything.

### Customer memory

For a returning founder, PayBench loads:

- prior URLs;
- prior test hypotheses;
- approved brand facts;
- previous results;
- delivery preferences;
- current opt-out status.

The product does not use previous results to invent facts for a new website.

### Sandbox memory

Supabase stores `superserve_sandbox_id`. The worker can reconnect after Superserve pauses the VM. Files and processes remain available. The worker pauses after each expensive stage and auto-deletes after the configured retention period.

### Evidence memory

Every model output points to screenshots, DOM paths, and captured text. Derived claims and raw evidence stay separate. This makes the report auditable.

## Storage design

Create one private Supabase bucket named `paybench-artifacts`.

Use paths such as:

```text
jobs/<job_id>/capture/desktop.png
jobs/<job_id>/capture/mobile.png
jobs/<job_id>/capture/dom.json
jobs/<job_id>/spec/paywall-spec-v1.json
jobs/<job_id>/variants/a.png
jobs/<job_id>/variants/b.png
jobs/<job_id>/reports/final.html
```

Generate signed URLs for reports and internal artifact access. Do not make the bucket public.

Enable Row Level Security on every exposed table. The browser must never receive `SUPABASE_SECRET_KEY`.

## Superserve worker design

Create a `paybench-browser` template with:

- Node.js;
- Playwright and Chromium;
- common web fonts;
- the PayBench renderer;
- axe-core for accessibility checks;
- screenshot comparison tools.

For each paid job:

1. Create a sandbox with `job_id` metadata.
2. Save the sandbox ID before running commands.
3. Bind OpenAI and Supabase credentials as Superserve secrets.
4. Capture the target page.
5. Write artifacts to Supabase.
6. Generate and validate A and B.
7. Start the preview server.
8. Publish one private preview port.
9. Create signed participant URLs.
10. Pause the sandbox while waiting for Terac results.
11. Reconnect for analysis and report generation.
12. Delete the sandbox after report retention expires.

The Superserve API key stays in the PayBench backend. Credentials used inside a sandbox use Superserve secret bindings, not plain environment variables.

## API routes

| Route | Purpose |
| --- | --- |
| `POST /api/webhooks/linq` | Verify inbound Linq events and advance the conversation |
| `POST /api/webhooks/stripe` | Verify payment events and mark a job paid |
| `POST /api/jobs` | Create a job from a website URL |
| `POST /api/jobs/:id/start` | Start the paid Superserve workflow |
| `POST /api/worker/callback` | Receive authenticated stage results from the worker |
| `POST /api/studies/:id/events` | Receive approved simulated-checkout events |
| `GET /r/:token` | Show a signed, expiring report |
| `GET /s/:token` | Open a signed participant test session |

All webhook routes use the raw body for signature verification. The worker callback uses `WORKER_CALLBACK_SECRET` and an idempotency key.

## Environment variables

The updated `.env.example` is the source of truth. Required new infrastructure is:

| Variable | Required | Where to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Now | Supabase project Connect dialog |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Now | Supabase Settings > API Keys |
| `SUPABASE_SECRET_KEY` | Now | Supabase Settings > API Keys; backend only |
| `SUPABASE_PROJECT_REF` | For migrations | Supabase project settings |
| `SUPABASE_ACCESS_TOKEN` | For CLI setup | Supabase account access tokens |
| `OPENAI_API_KEY` | Now | OpenAI API key page |
| `OPENAI_MODEL` | Now | A current multimodal model available to the account |
| `APP_SIGNING_SECRET` | Now | Generate locally as a random 32-byte value |
| `WORKER_CALLBACK_SECRET` | Now | Generate locally as a separate random 32-byte value |

Supabase now recommends `sb_publishable_...` and `sb_secret_...` keys. The secret key replaces the legacy `service_role` key for new projects. It must stay on the backend. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Existing sponsor credentials

| Variable | Status | Purpose |
| --- | --- | --- |
| `TERAC_API_KEY` | Already supplied | Create scout and participant studies |
| `SUPERSERVE_API_KEY` | Already supplied | Create and reconnect to worker VMs |
| `LINQ_API_KEY` | Already supplied | Linq API access |
| `LINQ_API_V3_API_KEY` | Already supplied | Linq SDK and CLI access |
| `LINQ_PHONE_NUMBER` | Already supplied | Display the inbound PayBench number |
| `REPLAY_QA_API_TOKEN` | Already supplied | Run Replay QA |

## Stripe values

The application needs:

- `STRIPE_PAYMENT_LINK_URL` after the live link exists;
- `STRIPE_WEBHOOK_SECRET` after the public webhook exists.

The application does not need `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, or `STRIPE_PRICE_ID` for the fixed Dashboard Payment Link MVP.

The organizer-only `rk_live_...` key never goes in the application. Submit it only with the team name and Payment Link.

## Values available only after deployment

These cannot be completed before PayBench has a public HTTPS URL:

- `STRIPE_WEBHOOK_SECRET`;
- `LINQ_WEBHOOK_URL`;
- `LINQ_WEBHOOK_SECRET`;
- `REPLAY_TARGET_URL`;
- production `APP_BASE_URL`.

## Replay setup choice

Use `REPLAY_QA_API_TOKEN` for the sponsor QA loop.

`REPLAY_API_KEY` is separate. It is only required if PayBench also records Playwright sessions with Replay Browser or uses Replay MCP. It is not required for the first complete MVP.

## Provisioning order

1. Finish the live PayBench Stripe account.
2. Create the live $20 Payment Link.
3. Create a Supabase project.
4. Copy the Supabase URL, publishable key, and secret key.
5. Create the private `paybench-artifacts` bucket.
6. Create the database tables and RLS policies.
7. Create the OpenAI API key.
8. Generate `APP_SIGNING_SECRET` and `WORKER_CALLBACK_SECRET`.
9. Build the `paybench-browser` Superserve template.
10. Build the Next.js intake, report, and webhook routes.
11. Import the GitHub repository into Vercel and deploy PayBench to a public HTTPS URL.
12. Create Stripe and Linq webhooks.
13. Set the Replay target URL.
14. Run one unpaid sandbox test.
15. Run one real $20 purchase end to end.
16. Launch the Terac study.
17. Fix Replay findings and rerun QA.

## Build order

### Milestone 1: paid intake

- Linq receives a URL.
- Supabase creates a job.
- Linq sends the job-specific Payment Link.
- Stripe webhook marks the job paid.

### Milestone 2: capture and variants

- Superserve captures one public test website.
- PayBench creates `PaywallSpec`.
- Renderer builds working A and B pages.
- Quality gates pass on desktop and mobile.

### Milestone 3: human study

- Terac opens signed participant links.
- Telemetry and explanations reach Supabase.
- Invalid sessions are separated from valid sessions.

### Milestone 4: report and delivery

- Analysis returns winner or no clear winner.
- Report shows evidence and limitations.
- Linq sends the signed report link.
- Replay returns a clean result after fixes.

## Failure handling

| Failure | Response |
| --- | --- |
| URL cannot load | Retry once, then create a Terac scout task |
| Login blocks the paywall | Ask for a public route or use scout evidence without credentials |
| Capture confidence is low | Stop generation and request scout evidence |
| Control is not faithful | Return to capture; do not test |
| Challenger invents a fact | Reject the change plan and regenerate |
| Superserve pauses | Reconnect using the stored sandbox ID |
| Stripe sends a duplicate event | Ignore it using `webhook_events` uniqueness |
| Participant page fails | Mark technical failure; do not count it as abandonment |
| Terac sample is incomplete | Report partial data or extend the study |
| Linq recipient opts out | Stop all outbound messages immediately |

## Security and privacy rules

- Never collect participant card numbers.
- Never copy source-site scripts or private data.
- Never store sponsor keys in database rows or browser code.
- Verify Stripe and Linq signatures before processing.
- Keep Supabase artifacts private.
- Use opaque signed tokens for report and study links.
- Block server-side request forgery before Superserve navigation.
- Remove or expire captured artifacts after the configured retention period.
- State clearly that generated pages are private research prototypes.
