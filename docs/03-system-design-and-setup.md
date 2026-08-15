# PayBench system design and setup

## Architecture decision

PayBench uses five runtime parts.

| Part | Choice | Purpose |
| --- | --- | --- |
| Web app and API | Next.js with TypeScript on Vercel | Intake, reports, Stripe and Linq webhooks, and study telemetry |
| Database and storage | Supabase | Durable workflow state, memory, behavior events, screenshots, and reports |
| Worker | Superserve | Browser capture, specification extraction, page rendering, and isolated execution |
| Model | Anthropic Claude Sonnet 4.6 | Structured page understanding and constrained change planning |
| Human testing | Terac | Scout fallback and participant evaluation |

Supabase, Anthropic, and Vercel are not hackathon sponsors. They are required infrastructure. The sponsor products remain visible in the core path.

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
        +-----> one neutral study URL -----> randomly assigned Terac end-users
        +-----> Replay QA
        |
        v
Report in Supabase -----> Linq delivery
```

## Shared implementation contract

Complete this section before Agent A or Agent B starts a workstream. Both agents must import the same types. They must not copy or redefine them.

### Target repository layout

```text
apps/
  web/                         # Next.js application
    app/admin/runs/            # Internal operator dashboard
    app/api/admin/runs/        # Read-only dashboard API and event stream
  worker/                      # Superserve worker
packages/
  contracts/                   # Shared schemas, types, enums, and event names
  db/                          # Typed Supabase repositories
  paywall/                     # Capture, PaywallSpec, renderer, and quality gates
  analysis/                    # Study validation, metrics, and report input
supabase/
  migrations/                  # Shared database schema and policies
  seed/                        # Safe local fixtures
tests/
  contracts/                   # Payload and state-transition tests
  fixtures/                    # Captured example pages and webhook payloads
```

The shared contract phase owns `packages/contracts`, `packages/db`, `supabase/migrations`, and `tests/contracts`. Workstream agents can use these paths but cannot change them without a contract review.

### Canonical identifiers

Use UUIDs for internal records:

- `customer_id`;
- `conversation_id`;
- `job_id`;
- `capture_id`;
- `variant_id`;
- `study_id`;
- `participant_session_id`;
- `agent_run_id`.

Use random opaque tokens for public links. Store only token hashes in Supabase. Never use a phone number, email address, page label, or Terac worker identifier in a public URL.

### Canonical enums

`packages/contracts` exports these exact values:

```ts
export const JobStatus = [
  "awaiting_confirmation",
  "awaiting_payment",
  "paid",
  "capturing",
  "needs_scout",
  "spec_ready",
  "building_variants",
  "quality_check",
  "recruiting",
  "testing",
  "analyzing",
  "replay_qa",
  "report_ready",
  "delivered",
  "failed",
] as const;

export const VariantLabel = ["A", "B"] as const;
export const ParticipantDecision = ["complete_simulated_purchase", "stop_here"] as const;
export const QualityStatus = ["pending", "valid", "flagged", "rejected", "technical_failure"] as const;
export const StudyStatus = ["draft", "recruiting", "complete", "insufficient_sample", "failed"] as const;
```

Only the orchestration service can change `jobs.status`. A worker returns facts. It does not choose the next job state.

### Shared payloads

Runtime validation uses Zod schemas from `packages/contracts`. Agent A sends commands. Agent B sends callbacks.

Every command uses this envelope:

```ts
type WorkerCommand<T> = {
  contract_version: "1";
  request_id: string;
  job_id: string;
  command_type: "capture_job" | "build_variants" | "start_study" | "run_replay_qa";
  callback_url: string;
  payload: T;
};
```

Every command gets a new `request_id`. Retrying the same command keeps the same `request_id`.

Every callback uses this envelope:

```ts
type WorkerCallback<T> = {
  contract_version: "1";
  callback_id: string;
  request_id: string;
  job_id: string;
  result_type:
    | "capture_result"
    | "scout_evidence_accepted"
    | "variant_build_result"
    | "study_started"
    | "study_result"
    | "replay_qa_result";
  payload: T;
};
```

Every callback gets a new `callback_id`. Agent A uses `callback_id` as the callback idempotency key. Agent A uses `request_id` to match the result to the command.

#### `CaptureJobRequest`

```ts
type CaptureJobRequest = WorkerCommand<{
  submitted_url: string;
  artifact_prefix: `jobs/${string}`;
  mode: "automatic" | "with_scout_evidence";
  scout_evidence_path?: string;
}>;
```

#### `CaptureJobResult`

```ts
type CaptureJobResult = WorkerCallback<{
  outcome: "spec_ready" | "needs_scout" | "failed";
  capture_id?: string;
  paywall_spec_path?: string;
  capture_confidence?: number;
  scout_task_id?: string;
  scout_url?: string;
  scout_reason?: string;
  error_code?: string;
}>;
```

#### `ScoutEvidenceAccepted`

```ts
type ScoutEvidenceAccepted = WorkerCallback<{
  scout_task_id: string;
  scout_evidence_path: string;
  confirmation_code_hash: string;
}>;
```

Agent A responds with a new `CaptureJobRequest`. It sets `mode` to `with_scout_evidence` and includes `scout_evidence_path`.

#### `VariantBuildRequest`

```ts
type VariantBuildRequest = WorkerCommand<{
  paywall_spec_path: string;
  artifact_prefix: `jobs/${string}/variants`;
  hypothesis_limit: 1;
}>;
```

#### `VariantBuildResult`

```ts
type VariantBuildResult = WorkerCallback<{
  outcome: "variants_ready" | "failed";
  variant_a_id?: string;
  variant_b_id?: string;
  preview_a_path?: string;
  preview_b_path?: string;
  study_url?: string;
  manifest_path?: string;
  quality_summary_path?: string;
  error_code?: string;
}>;
```

The manifest locks the source facts, hypothesis, component operations, artifact checksums, and renderer version.

#### `StudyStartRequest`

```ts
type StudyStartRequest = WorkerCommand<{
  manifest_path: string;
  study_url: string;
  target_participants: number;
  minimum_valid_per_variant: number;
  assignment_mode: "balanced_random";
  primary_metric: "simulated_purchase_decision_rate";
  simulated_budget: string;
}>;
```

#### `StudyStarted`

```ts
type StudyStarted = WorkerCallback<{
  outcome: "started" | "failed";
  study_id?: string;
  terac_study_id?: string;
  study_url?: string;
  error_code?: string;
}>;
```

#### `StudyResult`

```ts
type StudyResult = WorkerCallback<{
  study_id: string;
  outcome: "complete" | "insufficient_sample" | "failed";
  valid_a: number;
  valid_b: number;
  technical_failures: number;
  primary_metric: "simulated_purchase_decision_rate";
  result: "A" | "B" | "no_clear_winner";
  metrics_path: string;
  report_input_path: string;
  error_code?: string;
}>;
```

#### `ReplayQaRequest`

```ts
type ReplayQaRequest = WorkerCommand<{
  preview_a_path: string;
  preview_b_path: string;
  report_input_path: string;
}>;
```

#### `ReplayQaResult`

```ts
type ReplayQaResult = WorkerCallback<{
  outcome: "passed" | "failed";
  replay_run_url?: string;
  findings_path?: string;
  error_code?: string;
}>;
```

### Shared HTTP contract

| Method and route | Owner | Caller | Result |
| --- | --- | --- | --- |
| `POST /api/webhooks/linq` | Agent A | Linq | Verifies the event and creates or advances a conversation |
| `POST /api/webhooks/stripe` | Agent A | Stripe | Verifies payment and marks one job paid |
| `POST /api/jobs/:id/start` | Agent A | Agent A | Sends one `CaptureJobRequest` |
| `POST /api/worker/callback` | Agent A | Agent B | Accepts a signed shared result payload |
| `GET /scout/:token` | Agent B | Terac end-user | Shows one capture task and evidence form |
| `POST /api/scout/:token` | Agent B | Terac end-user | Stores evidence and returns one `PB-SCOUT-` code |
| `GET /s/:token` | Agent B | Terac end-user | Creates a session and returns one assigned page |
| `POST /api/studies/:id/events` | Agent B | Study page | Stores allow-listed behavior events |
| `POST /api/studies/:id/decision` | Agent B | Study page | Stores one decision and the required survey |
| `GET /r/:token` | Agent A | Founder | Shows one signed report |
| `GET /api/admin/runs` | Dashboard | Operator | Lists founders and runs without sensitive identifiers |
| `GET /api/admin/runs/:id` | Dashboard | Operator | Returns one canonical run snapshot |
| `GET /api/admin/runs/:id/events` | Dashboard | Operator | Streams safe run events with server-sent events |

Every mutation returns `{ ok, data?, error? }`. Errors use a stable `code` and safe `message`. No route returns a sponsor key, Supabase secret, raw public-link token, or page assignment label.

### Internal dashboard contract

The dashboard is a read model over canonical workflow records. It must not maintain a second job state machine.

```ts
type DashboardStageId =
  | "intake"
  | "payment"
  | "capture"
  | "variants"
  | "study"
  | "replay"
  | "report"
  | "delivery";

type DashboardStageStatus =
  | "waiting"
  | "running"
  | "blocked"
  | "complete"
  | "failed";

type DashboardStage = {
  id: DashboardStageId;
  status: DashboardStageStatus;
  actor: "paybench" | "stripe" | "superserve" | "terac" | "replay" | "linq";
  label: string;
  detail?: string;
  started_at?: string;
  completed_at?: string;
};

type SandboxLiveState = {
  variant: "A" | "B";
  sandbox_id: string;
  status: "queued" | "booting" | "navigating" | "capturing" | "editing" | "validating" | "ready" | "paused" | "failed";
  task: string;
  viewer_url?: string;
  preview_url?: string;
  latest_frame_url?: string;
  last_activity_at: string;
};

type ReplayLiveState = {
  status: "queued" | "recording" | "checking" | "passed" | "failed";
  current_journey?: string;
  completed_checks: number;
  total_checks: number;
  blocking_findings: number;
  run_url?: string;
  last_activity_at?: string;
};

type DashboardRunSnapshot = {
  contract_version: "1";
  job_id: string;
  founder_label: string;
  website_url: string;
  job_status: (typeof JobStatus)[number];
  source: "live" | "demo";
  paid: boolean;
  amount_paid_cents: number;
  currency: string;
  current_stage: DashboardStageId;
  blocker?: { code: string; label: string };
  next_action?: string;
  stages: DashboardStage[];
  sandboxes: SandboxLiveState[];
  study: {
    target: number;
    valid: number;
    a_valid: number;
    b_valid: number;
    flagged: number;
    rejected: number;
    technical_failures: number;
  };
  replay: ReplayLiveState;
  artifacts: Array<{
    kind: "capture" | "spec" | "variant_a" | "variant_b" | "metrics" | "report";
    label: string;
    object_path: string;
    created_at: string;
  }>;
  updated_at: string;
};

type DashboardRunEvent = {
  event_id: string;
  job_id: string;
  stage: DashboardStageId;
  status: DashboardStageStatus;
  actor: DashboardStage["actor"];
  summary: string;
  occurred_at: string;
};
```

Rules:

1. Select one run by `job_id`; never infer identity from a URL or phone number.
2. Derive stages from `jobs.status`, payments, `agent_runs`, study counts, Replay results, reports, and delivery records.
3. Use server-sent events for live updates and a 15-second snapshot refresh as fallback.
4. Keep event summaries allow-listed and under 120 characters.
5. Expire all external viewer and artifact links. The API returns no permanent public object URL.
6. Protect every `/admin/*` and `/api/admin/*` route with the operator access check.
7. Mark fixtures `source: "demo"`. Never present fixture activity as a live sponsor run.

### Behavior event contract

The study page can send only these event names:

```text
page_view
first_interaction
plan_selected
primary_action_clicked
stop_action_clicked
field_focused
field_corrected
validation_error
back_navigation
simulated_purchase_completed
survey_submitted
technical_error
```

Each event includes `participant_session_id`, `variant_id`, `event_name`, `event_time`, `sequence_number`, `element_key`, and safe `metadata`. The API rejects unknown names, duplicate sequence numbers, and events sent after session completion.

### Artifact contract

Both workstreams use these private Supabase Storage paths:

```text
jobs/<job_id>/capture/*
jobs/<job_id>/spec/paywall-spec-v1.json
jobs/<job_id>/variants/manifest-v1.json
jobs/<job_id>/variants/a/*
jobs/<job_id>/variants/b/*
jobs/<job_id>/study/metrics-v1.json
jobs/<job_id>/reports/report-input-v1.json
jobs/<job_id>/reports/final.html
```

Each JSON artifact contains `contract_version`, `job_id`, `created_at`, and `checksum`. Buckets stay private. Agents exchange object paths, not permanent public URLs.

### Authentication and idempotency contract

- Linq webhooks use the raw body and Linq signature verification.
- Stripe webhooks use the raw body and Stripe signature verification.
- Worker callbacks use `WORKER_CALLBACK_SECRET`, a timestamp, and an HMAC signature.
- Public report, scout, and study links use signed opaque tokens with expiration.
- Every webhook and callback has a provider event ID or idempotency key.
- Supabase enforces one record for each provider event ID or idempotency key.
- A repeated valid request returns the first result. It does not repeat the side effect.

### State-transition contract

Agent A owns this state machine. Agent B can request a transition only through a typed callback.

```text
awaiting_confirmation -> awaiting_payment -> paid
paid -> capturing
capturing -> needs_scout | spec_ready | failed
needs_scout -> capturing | failed
spec_ready -> building_variants
building_variants -> quality_check | failed
quality_check -> recruiting | building_variants | failed
recruiting -> testing
testing -> analyzing | failed
analyzing -> replay_qa | failed
replay_qa -> report_ready | failed
report_ready -> delivered
```

The transition service records the old state, new state, actor, reason, and time. An invalid transition returns `INVALID_JOB_TRANSITION` and changes nothing.

| Accepted result | Agent A action |
| --- | --- |
| `CaptureJobResult: needs_scout` | Move `capturing -> needs_scout` and wait for `ScoutEvidenceAccepted` |
| `ScoutEvidenceAccepted` | Move `needs_scout -> capturing` and send a scout-backed `CaptureJobRequest` |
| `CaptureJobResult: spec_ready` | Move `capturing -> spec_ready -> building_variants` and send `VariantBuildRequest` |
| `VariantBuildResult: variants_ready` | Move `building_variants -> quality_check -> recruiting` and send `StudyStartRequest` |
| `StudyStarted: started` | Move `recruiting -> testing` |
| `StudyResult: complete` | Move `testing -> analyzing -> replay_qa` and send `ReplayQaRequest` |
| `StudyResult: insufficient_sample` | Follow the same report path and force `no_clear_winner` |
| `ReplayQaResult: passed` | Move `replay_qa -> report_ready` |
| Any terminal `failed` result | Move the current job to `failed` with its stable error code |

### Contract fixtures

The shared phase creates these safe fixtures:

- one valid Linq inbound event;
- one duplicate Linq event;
- one valid Stripe `checkout.session.completed` event;
- one duplicate Stripe event;
- one successful capture result;
- one `needs_scout` capture result;
- one accepted scout-evidence callback;
- one variant-build request and result;
- one valid variant manifest;
- one study-start request and started callback;
- one valid A session and one valid B session;
- one `stop_here` decision;
- one technical failure;
- one complete study result;
- one Replay QA request and passed result;
- one `no_clear_winner` report input.

### Shared contract definition of done

The split can start only when all items are true:

1. The shared Zod schemas compile.
2. The first Supabase migration applies to an empty local database.
3. Generated database types match the migration.
4. Contract tests accept every valid fixture.
5. Contract tests reject invalid enums, signatures, transitions, and duplicate events.
6. A mock Agent A sends every shared command type to a mock Agent B.
7. A mock Agent B returns every shared callback type to the Agent A callback.
8. CI runs type-checking and contract tests.
9. Both agents use the same frozen commit SHA.

After this point, a contract change needs one written change note. The note lists the schema change, migration, fixtures, and effect on both workstreams.

### Contract change note 1

The first split review found missing stage commands. Contract version `1` now includes `VariantBuildRequest`, `StudyStartRequest`, `ReplayQaRequest`, `ScoutEvidenceAccepted`, `StudyStarted`, and `ReplayQaResult`.

- **Schema effect:** add the new Zod command and callback schemas. Add `request_id`, `callback_id`, `command_type`, and `result_type` to their envelopes.
- **Migration effect:** no new product table is required. Store command requests and callbacks in `agent_runs` and `webhook_events`.
- **Fixture effect:** add one valid fixture for each new command and callback.
- **Agent A effect:** send each stage command and match callbacks by `request_id`.
- **Agent B effect:** accept each stage command and use a unique `callback_id` for every callback.

### Contract change note 2

The operator dashboard adds a read-only projection without changing workflow ownership.

- **Schema effect:** export `DashboardRunSnapshot`, `DashboardRunEvent`, stage, sandbox, and Replay schemas from `packages/contracts`.
- **Migration effect:** add append-only `job_transitions` and safe dashboard projection fields to `agent_runs`; do not duplicate `jobs.status`.
- **Fixture effect:** add one paid live-shaped run, one blocked scout run, and one failed Replay run. Mark all fixtures `source: "demo"`.
- **Agent A effect:** expose authenticated list, snapshot, and event-stream routes.
- **Agent B effect:** publish safe sandbox, study, and Replay events through existing callbacks.
- **Dashboard effect:** consume only the shared schemas and never write orchestration state.

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
- `minimum_valid_per_variant`
- `assignment_mode`
- `primary_metric`
- `status`
- `started_at`
- `completed_at`

### `participant_sessions`

- `id`
- `study_id`
- `participant_token_hash`
- `assigned_variant_id`
- `confirmation_code_hash`
- `confirmation_code_used_at`
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
- `understood_offer_text`
- `understood_price_terms_text`
- `hesitation_text`
- `clarity_score`
- `trust_score`
- `would_continue_with_real_money`
- `continuation_reason_text`

### `scout_tasks`

- `id`
- `job_id`
- `terac_task_id`
- `task_token_hash`
- `target_url`
- `final_url`
- `click_path_json`
- `visible_offer_text`
- `artifact_paths`
- `blocker_text`
- `confirmation_code_hash`
- `quality_status`
- `submitted_at`

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
- `request_id`
- `callback_id`
- `command_type`
- `result_type`
- `stage`
- `model`
- `input_artifact_paths`
- `output_artifact_path`
- `prompt_version`
- `status`
- `error_code`
- `started_at`
- `completed_at`

Use a unique constraint on `request_id`. Use a second unique constraint on non-null `callback_id`.

### `job_transitions`

- `id`
- `job_id`
- `from_status`
- `to_status`
- `stage`
- `actor`
- `reason_code`
- `safe_summary`
- `idempotency_key`
- `occurred_at`

Rows are append-only. `safe_summary` is allow-listed, contains no external payload, and is limited to 120 characters. The dashboard event stream reads this table plus safe `agent_runs` progress fields.

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
3. Bind Anthropic and Supabase credentials as Superserve secrets.
4. Capture the target page.
5. Write artifacts to Supabase.
6. Generate and validate A and B.
7. Start the preview server.
8. Publish one private preview port.
9. Create one signed study URL; assign one page per end-user on first open.
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
| `GET /scout/:token` | Show the exact target link and evidence form to one Terac scout |
| `POST /api/scout/:token` | Store valid scout evidence and issue a one-use code |
| `POST /api/studies/:id/events` | Receive approved simulated-checkout events |
| `GET /r/:token` | Show a signed, expiring report |
| `GET /s/:token` | Open a signed participant test session |
| `GET /api/admin/runs` | List dashboard-safe founder runs |
| `GET /api/admin/runs/:id` | Read one canonical run snapshot |
| `GET /api/admin/runs/:id/events` | Stream safe run events |

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
| `ANTHROPIC_API_KEY` | Now | Anthropic Console API Keys page; backend only |
| `ANTHROPIC_MODEL` | Now | `claude-sonnet-4-6` by default; current Claude models support image input |
| `APP_SIGNING_SECRET` | Now | Generate locally as a random 32-byte value |
| `WORKER_CALLBACK_SECRET` | Now | Generate locally as a separate random 32-byte value |
| `DASHBOARD_ACCESS_KEY` | Now | Generate locally as a random operator-only value |

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

### Stripe completion checklist

Creating the Payment Link is one completed step. It is not the whole Stripe setup.

1. Stay in the new PayBench Stripe account. Do not create another account or another Payment Link.
2. Wait for Stripe's background verification. Check the Stripe notifications and **Settings > Account status**. If Stripe shows no requested task, there is nothing to enter while the review is pending.
3. When Stripe approves the account, confirm that live Payments are active. Open the submitted Payment Link in a private browser window and confirm that the live checkout loads without a payments-disabled message.
4. Put that one link in `STRIPE_PAYMENT_LINK_URL`. Keep using the same submitted link for every hackathon customer.
5. For the hackathon organizer only, open **Developers > API keys > Restricted keys > Create restricted key** in the PayBench account. Name it `Hackathon revenue verification`, give **Read** access to **Balance** and **Charges**, and leave every other permission as **None**. Submit the resulting `rk_live_...` key through the organizer's private form. Do not put it in `.env`, GitHub, chat, or the PayBench application.
6. After PayBench has a public HTTPS address, create the Stripe webhook endpoint `https://YOUR_DOMAIN/api/webhooks/stripe`. Listen for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`. Copy that endpoint's `whsec_...` signing secret into `STRIPE_WEBHOOK_SECRET`.
7. Complete one real purchase from a consenting customer through the submitted live link. A sandbox purchase or PayBench participant's simulated purchase does not count as revenue.

The application can be built while verification is pending. Live revenue and automatic fulfillment must wait until Stripe enables live payments. The Payment Link takes the founder's real $20 payment; it is never used for Terac's simulated checkout.

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
7. Create the Anthropic API key.
8. Generate `APP_SIGNING_SECRET` and `WORKER_CALLBACK_SECRET`.
9. Generate `DASHBOARD_ACCESS_KEY` and protect the internal dashboard.
10. Build the `paybench-browser` Superserve template.
11. Build the Next.js intake, report, webhook, and dashboard routes.
12. Import the GitHub repository into Vercel and deploy PayBench to a public HTTPS URL.
13. Create Stripe and Linq webhooks.
14. Set the Replay target URL.
15. Run one unpaid sandbox test.
16. Run one real $20 purchase end to end.
17. Launch the Terac study.
18. Fix Replay findings and rerun QA.

## Parallel implementation workstreams

The shared contract must pass its definition of done first. Then Agent A and Agent B work in parallel from the same contract commit.

## Workstream A — control plane

Agent A can complete this workstream with the shared fixtures and a mock Agent B adapter.

### Agent A owned paths

```text
apps/web/app/api/webhooks/linq/**
apps/web/app/api/webhooks/stripe/**
apps/web/app/api/jobs/**
apps/web/app/api/worker/callback/**
apps/web/app/api/admin/**
apps/web/app/admin/**
apps/web/app/r/**
apps/web/components/dashboard/**
apps/web/src/server/dashboard/**
apps/web/src/server/linq/**
apps/web/src/server/stripe/**
apps/web/src/server/orchestration/**
apps/web/src/server/reports/**
apps/web/src/server/experiment-engine/**
tests/workstream-a/**
tests/dashboard-api/**
```

Agent A imports `packages/contracts` and `packages/db`. Agent A does not change shared schemas or migrations during the workstream.

### Agent A inputs

- verified Linq inbound events;
- verified Stripe payment events;
- `CaptureJobResult` callbacks;
- `ScoutEvidenceAccepted` callbacks;
- `VariantBuildResult` callbacks;
- `StudyStarted` callbacks;
- `StudyResult` and `report-input-v1.json`;
- `ReplayQaResult` callbacks;
- shared contract fixtures.

### Agent A outputs

- one durable founder conversation;
- one job linked to the submitted URL;
- one job-specific Payment Link URL;
- one idempotent paid state;
- one `CaptureJobRequest`;
- one `VariantBuildRequest`;
- one `StudyStartRequest`;
- one `ReplayQaRequest`;
- accepted signed worker results;
- one final signed report URL;
- one compliant Linq delivery message.

### Agent A must not own

- browser capture;
- `PaywallSpec` creation;
- page rendering;
- Terac scout or participant pages;
- participant assignment;
- study events or analysis;
- Replay execution.

### Agent A mock for Workstream B

Create an `ExperimentEngineClient` interface with two implementations:

1. `MockExperimentEngineClient` reads shared fixtures and sends valid callbacks.
2. `HttpExperimentEngineClient` starts the real Superserve workflow.

Both implementations accept every shared `WorkerCommand`. The application selects one implementation with configuration. Business logic must not know which implementation is active.

### Agent A ordered tasks

1. Scaffold the owned Next.js routes and server modules.
2. Validate required environment variables when the server starts.
3. Connect the shared typed Supabase repositories.
4. Implement the Linq webhook with raw-body signature verification.
5. Store inbound messages once by Linq event ID.
6. Parse and validate one public `http` or `https` website URL.
7. Create the founder, conversation, and job records in one transaction.
8. Send the link-free confirmation reply.
9. Send the Payment Link only after the founder replies `YES`.
10. Append `client_reference_id=<job_id>` to the one submitted Payment Link.
11. Implement the Stripe webhook with raw-body signature verification.
12. Mark the job paid only for a successful matching Checkout Session.
13. Send one `CaptureJobRequest` after the first valid payment event.
14. Implement the job transition service from the shared state machine.
15. Verify worker callback HMAC, timestamp, payload schema, and idempotency key.
16. Apply each valid result to the job state without repeating side effects.
17. Send `VariantBuildRequest` after a valid `spec_ready` result.
18. Send `StudyStartRequest` after valid variants pass quality gates.
19. Send `ReplayQaRequest` after a complete or insufficient study result.
20. Read `report-input-v1.json` only after Replay QA passes.
21. Render the final report without changing metrics.
22. Create a signed, expiring `/r/:token` report link.
23. Deliver the report through Linq once.
24. Stop all messages after an opt-out.
25. Add structured logs that contain IDs and error codes, not secrets or message contents.
26. Build the protected internal run dashboard from the shared snapshot and event schemas.
27. Derive dashboard state from canonical workflow records; do not create a second state machine.
28. Stream safe run events and fall back to a 15-second snapshot refresh.
29. Show two Superserve work surfaces, aggregate Terac progress, Replay QA, artifacts, and delivery state.
30. Mark every fixture and mock run as `Demo`.

### Agent A tests

- valid, invalid, and duplicate Linq signatures;
- `STOP` and clear natural-language opt-outs;
- invalid and private-network URLs;
- no link in the first outbound message;
- correct `client_reference_id` for each job;
- valid, invalid, delayed, and duplicate Stripe events;
- payment for the wrong job;
- each valid and invalid job transition;
- valid, expired, and duplicate worker callbacks;
- mock `spec_ready`, `needs_scout`, scout-accepted, variants-ready, study-started, complete-study, and Replay results;
- signed report access and expiration;
- exactly one final Linq delivery.
- dashboard access denied without the operator key;
- dashboard snapshots and events pass shared schemas;
- fixture runs are visibly marked `Demo`;
- no dashboard response contains secrets, raw codes, phone numbers, payment details, or survey free text.

### Agent A checkpoints

1. **Intake checkpoint:** a Linq fixture creates one job and one confirmation reply.
2. **Revenue checkpoint:** a Stripe fixture moves that job to `paid` exactly once.
3. **Start checkpoint:** the mock client receives one valid `CaptureJobRequest`.
4. **Callback checkpoint:** each shared result fixture causes the correct transition and next command.
5. **Delivery checkpoint:** a complete study fixture creates one report and one Linq message.

### Agent A definition of done

Workstream A is complete when all checkpoints pass without real Agent B code. It must also pass type-checking, contract tests, owned tests, and a clean production build.

## Workstream B — experiment engine

Agent B owns the full experiment engine. The executable plan is in [02-paywall-engine.md](./02-paywall-engine.md#workstream-b--experiment-engine).

Agent B must finish with mock jobs and a mock Agent A callback receiver. Workstream B is not blocked by Linq, Stripe, founder reports, or final delivery.

## Final integration

Start final integration only after both workstreams pass their independent definitions of done.

1. Confirm that both workstreams use the same shared contract commit.
2. Run all contract tests before connecting real adapters.
3. Replace Agent A's mock experiment client with `HttpExperimentEngineClient`.
4. Point Agent B's callbacks to Agent A's signed callback route.
5. Run one fixture job through capture, variant generation, study, analysis, and report delivery.
6. Run the `needs_scout` path and submit one valid `PB-SCOUT-` code.
7. Run one A session, one B session, one `stop_here` decision, and one technical failure.
8. Confirm that the report metrics equal the stored study artifact.
9. Run Replay against the integrated app and both generated pages.
10. Fix all blocking findings and rerun the complete fixture journey.
11. After Stripe enables live payments, run one real $20 founder purchase.
12. Launch the real Terac study only after the fixture journey passes.

No workstream can claim that PayBench is complete by itself. Product completion requires the real Agent A adapter, the real Agent B adapter, one paid founder journey, valid Terac evidence, and final Linq delivery.

## Terac operating rules

There are two different Terac jobs:

1. **Scout capture job:** one end-user follows the exact target website shown in PayBench, stops before payment, and submits URLs, screenshots, click steps, and exact visible offer text through the PayBench scout form. The copy-and-paste job is in [02-paywall-engine.md](./02-paywall-engine.md#terac-scout-fallback).
2. **Blinded purchase task:** many end-users receive the same neutral study URL and simulated budget. Each sees one assigned page only and chooses either **Complete simulated purchase** or **I would stop here**. The copy-and-paste job is in [01-product.md](./01-product.md#terac-job-2-blinded-end-user-purchase-task).

Never rely on a Terac text answer alone. Accept a job only when its one-use PayBench completion code matches a server record. The scout code requires submitted evidence. The participant code requires a loaded assigned page, required behavior events, and completed questions.

Before posting either job, replace every `{{PLACEHOLDER}}`, open the link in a private browser window, complete the task once, and confirm that PayBench issues a valid code.

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
