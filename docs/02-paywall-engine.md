# Paywall capture and generation engine

## Core rule

The model does not generate a paywall from a screenshot and a loose prompt.

The engine first creates an evidence-backed `PaywallSpec`. A deterministic renderer then builds both pages from approved components.

This prevents invented prices, generic copy, broken forms, and off-brand layouts.

## Stage 1: safe website capture

The Superserve worker receives `job_id` and the submitted URL. It runs Playwright inside a dedicated sandbox.

Before navigation, PayBench:

- accepts only `http` and `https` URLs;
- resolves the host and rejects private, loopback, and link-local addresses;
- limits redirects;
- limits file size and page load time;
- never uses founder or PayBench login credentials;
- records the final URL and timestamp.

The worker captures:

- desktop screenshot at 1440 by 1000;
- mobile screenshot at 390 by 844;
- full-page screenshot;
- relevant DOM subtree;
- visible text and accessibility names;
- computed styles for the checkout region;
- CSS variables;
- logo, favicon, and public image URLs;
- network failures and console errors;
- the interaction steps used to reach the paywall.

Artifacts go to a private Supabase Storage bucket. The database stores their object paths and checksums.

## Stage 2: find the checkout or paywall

The detector scores visible regions using:

- price and currency text;
- plan names;
- purchase or subscribe buttons;
- payment fields;
- billing interval controls;
- modal and drawer semantics;
- checkout-related URL paths;
- headings such as Upgrade, Continue, Buy, Subscribe, or Checkout.

The model receives screenshots, DOM evidence, and these candidates. It returns structured JSON only.

If confidence is below the configured threshold, PayBench does not guess. It creates a Terac scout task.

## Terac scout fallback

PayBench creates a private scout form at `{{SCOUT_FORM_URL}}`. The form displays the customer-supplied `{{TARGET_URL}}` and has separate fields for the final URL, click path, screenshots, visible text, and blockers.

Copy this text into the Terac job:

> **Title:** Find and capture the public purchase page for a website
>
> **Your role:** Act as a new end-user who wants to understand the product and reach the point immediately before payment.
>
> **Open the PayBench task form:** `{{SCOUT_FORM_URL}}`
>
> The form will show the exact website under **Target website**. Open that target link in a new browser tab.
>
> **What to do:**
> 1. Start at the target link shown in the form.
> 2. Use the public website as a normal new customer would.
> 3. Find the first page that asks you to choose a plan, start a trial, subscribe, buy, or enter payment details.
> 4. Stop before any real purchase, trial, or account is created.
> 5. In the PayBench form, paste the final page URL.
> 6. Upload one full-page desktop screenshot. If the page changes after a click, also upload the state immediately before payment.
> 7. Write the exact clicks you made, one per line, starting from the target link.
> 8. Copy the exact visible product or plan names, prices, billing period, trial terms, main purchase button text, and nearby legal or cancellation text.
> 9. If login, location, a broken page, or another block prevents access, stop and describe the block. Upload a screenshot of it.
> 10. Submit the PayBench form. Copy the confirmation code that starts with `PB-SCOUT-` into your Terac submission.
>
> **Do not:** buy anything, start a real trial, create an account, enter a password, enter a card number, upload private information, copy website source code, or guess text that is not visible.
>
> **The task is complete only when:** the PayBench form is submitted and your valid `PB-SCOUT-` code is pasted into Terac.

Example of a complete response:

```text
Target website shown in PayBench: https://example.com/pricing
Final page: https://example.com/checkout
Clicks:
1. Clicked “Pricing” in the header.
2. Selected “Pro”.
3. Clicked “Start Pro”.
Stopped at: the page asking for payment details.
Visible offer: Pro — $20 per month, billed monthly.
Main button: Start subscription.
Legal text: Cancel at any time.
Files: pricing-full-page.png, checkout-before-payment.png
Completion code: PB-SCOUT-7K4M2Q
```

The example domains and code are placeholders. Each real job must contain its own PayBench form link. PayBench verifies that the code belongs to the scout task and that the required evidence fields exist before accepting the work.

The worker merges the accepted evidence into the same `PaywallSpec`. The rest of the pipeline stays unchanged.

## Stage 3: extract the brand

PayBench creates a `BrandSpec` from measured evidence.

| Field | Source |
| --- | --- |
| Logo | Header image, structured metadata, or favicon |
| Primary and accent colors | CSS variables and screenshot color clusters |
| Fonts | Computed `font-family`, weight, and size |
| Spacing | Measured gaps, padding, and container widths |
| Shape | Border radius, border width, and shadow values |
| Button style | CTA dimensions, color, type, and text case |
| Voice | Existing headings, descriptions, and CTA verbs |

Every extracted value stores:

- the value;
- its source URL;
- a DOM selector or screenshot region;
- a confidence score;
- the capture timestamp.

The generator cannot use a low-confidence value without a fallback rule.

## Stage 4: create the paywall specification

`PaywallSpec` is the stable contract between capture, generation, testing, and reporting.

```json
{
  "brand": {},
  "offer": {
    "productName": "",
    "plans": [],
    "prices": [],
    "billingIntervals": [],
    "trialTerms": [],
    "guarantees": []
  },
  "content": {
    "headline": "",
    "supportingCopy": [],
    "features": [],
    "trustItems": [],
    "legalText": []
  },
  "form": {
    "fields": [],
    "cta": "",
    "steps": []
  },
  "layout": {},
  "evidence": [],
  "captureConfidence": 0
}
```

Prices, billing intervals, legal text, product claims, and guarantee terms are locked facts. The alternative cannot change them.

## Stage 5: diagnose one problem

The engine chooses one test hypothesis. It does not redesign everything.

Allowed hypothesis groups are:

1. **Value clarity**: improve the order and wording of existing benefits.
2. **Trust**: move existing security, refund, or customer proof closer to the decision.
3. **Cognitive load**: reduce visual competition and group related information.
4. **Form friction**: improve labels, error placement, and step order without removing required fields.
5. **Price presentation**: improve the display of the existing price without changing the amount or billing terms.

The model returns a `ChangePlan` with:

- diagnosed problem;
- supporting evidence;
- one primary metric;
- locked facts;
- exact component operations;
- expected risk;
- rejection conditions.

## Stage 6: build control A

Control A is a functional recreation, not a screenshot.

The renderer uses a small React component library:

- `PaywallShell`;
- `BrandHeader`;
- `OfferSummary`;
- `PlanSelector`;
- `BenefitList`;
- `TrustPanel`;
- `CheckoutForm`;
- `OrderSummary`;
- `PrimaryAction`;
- `LegalFooter`;
- `SimulationNotice`.

The renderer maps the original structure and brand tokens into these components. It does not execute scripts copied from the target website.

Control A must pass a visual-fidelity gate before challenger B is generated. The gate checks:

- layout similarity;
- text completeness;
- price and term equality;
- logo and color correctness;
- desktop and mobile behavior;
- keyboard access;
- absence of console errors.

## Stage 7: build challenger B

The model does not write raw HTML. It chooses approved component operations such as:

- move `TrustPanel` below `OrderSummary`;
- place the CTA after the selected plan;
- shorten a heading using only claims found in evidence;
- group benefits into three existing themes;
- show the order summary before the simulated payment step;
- improve a label or validation message.

The renderer applies the operations to the control tree. Schema validation rejects unknown components, scripts, external trackers, or unsupported properties.

## Non-negotiable generation constraints

Challenger B must not:

- change the price;
- create a discount;
- create a free trial;
- invent customer counts, reviews, security claims, or guarantees;
- remove legal text;
- collect real payment data;
- change the product being sold;
- add unrelated gradients, illustrations, icons, or marketing copy;
- load code from the source website;
- change more than one hypothesis group in the first test.

## Stage 8: automated quality gates

Both pages must pass:

1. schema validation;
2. source-fact validation;
3. screenshot comparison;
4. responsive checks at mobile and desktop sizes;
5. keyboard navigation;
6. color contrast checks;
7. simulated form completion;
8. event emission checks;
9. console and network error checks;
10. Replay QA.

If control A fails fidelity, the job returns to capture. If challenger B fails, the engine retries only the failed operation. After two failed attempts, it requests a Terac scout or marks the job for manual review.

## Stage 9: host the study pages

The worker starts the variant app on one Superserve port. It publishes that port with private preview access.

PayBench creates one short-lived signed study URL for the Terac job. It stores the sandbox ID in Supabase, so another process can reconnect after a pause.

Terac receives one neutral study URL. When an end-user first opens it, PayBench creates an opaque participant session and assigns exactly one page. Assignment uses shuffled blocks of four with two A and two B positions in random order. The database saves the assignment before rendering. A refresh returns the same page.

The URL contains only an opaque `study_token`. The participant session uses a secure, HTTP-only cookie. Neither value contains a phone number, email address, page label, or secret.

## Stage 10: simulated checkout

The checkout UI shows a clear simulation notice and the task-specific simulated budget. PayBench supplies:

- a fake customer name;
- a fake billing address;
- a fixed fake payment token;
- a task-specific purchase goal.

The end-user can complete the flow without typing a card number. The purchase action says `Complete simulated purchase`, not `Pay now`. A persistent secondary action says `I would stop here`. Choosing either action records the decision and opens the same survey. This avoids forcing every paid worker to finish the checkout.

After either decision, the same page asks:

1. What did you think you were buying?
2. What price and billing terms did you understand?
3. What, if anything, made you hesitate?
4. How clear was the offer, from 1 to 5?
5. How trustworthy did the page feel, from 1 to 5?
6. Would you continue if this used real money? Why or why not?

After all required questions are answered, the server creates a one-use `PB-` completion code. The end-user pastes that code into Terac. The code links the Terac submission to the server-side session without exposing which page was assigned or which decision was made.

The telemetry endpoint accepts only approved event names. It rate-limits each participant token and rejects events after completion.

## Stage 11: human evidence quality

PayBench rejects or flags a participant session when:

- the assigned page never loaded;
- the participant completed too quickly to view the offer;
- required event checkpoints are missing;
- the written reason is empty or copied;
- the same participant token is reused;
- the `PB-` completion code is missing, invalid, or already used;
- the participant reports a technical failure;
- the stored page assignment changes during the session.

Technical failures do not count as conversion failures. They go to the Replay and engineering queue.

## Stage 12: analysis and report

The analysis joins event data and Terac responses by participant token. It calculates:

- completion difference;
- median time difference;
- error and backtrack difference;
- clarity and trust difference;
- understood-offer and understood-price accuracy;
- real-money continuation intent;
- recurring reasons;
- technical-failure rate.

The report contains screenshots, the exact change, the evidence, limitations, and a recommendation. It never hides the sample size.

## Workstream B — experiment engine

Agent B implements the full experiment engine from the frozen shared contract at commit `53db49a`.

Agent B can finish with local fixtures and mocks. It does not need unfinished Agent A code, live payments, Linq, or founder report delivery.

### Owned paths

Agent B owns only these paths:

```text
apps/worker/**
apps/web/app/scout/[token]/**
apps/web/app/s/[token]/**
apps/web/app/api/scout/[token]/**
apps/web/app/api/studies/[id]/events/**
apps/web/app/api/studies/[id]/decision/**
apps/web/src/server/scout/**
apps/web/src/server/studies/**
apps/web/src/server/terac/**
apps/web/src/server/replay/**
packages/paywall/**
packages/analysis/**
tests/workstream-b/**
```

Agent B imports `packages/contracts` and `packages/db`. It treats them as read-only.

Agent B must not edit or own:

- shared schemas, repositories, migrations, seeds, or contract tests;
- Agent A routes or server modules;
- Linq, Stripe, `jobs.status`, or final report delivery;
- `apps/web/app/r/**` or `jobs/<job_id>/reports/final.html`;
- root dependencies, lockfiles, or deployment files without a contract review.

Only Agent A changes `jobs.status`. Agent B returns facts through typed callbacks.

### Shared boundary

The worker validates all inputs and outputs with Zod schemas from `packages/contracts`. It never copies a shared type.

| Agent A command | Agent B work | Agent B callback |
| --- | --- | --- |
| `CaptureJobRequest` | Capture automatically or rebuild with accepted scout evidence | `CaptureJobResult`, including `needs_scout` when required |
| Accepted scout submission | Validate and store the evidence | `ScoutEvidenceAccepted` after evidence arrives |
| `VariantBuildRequest` | Build and check A and B | `VariantBuildResult` |
| `StudyStartRequest` | Create the blinded Terac study | `StudyStarted`, then one terminal `StudyResult` |
| `ReplayQaRequest` | Test both pages and the report input | `ReplayQaResult` |

Every command uses `WorkerCommand` with `contract_version: "1"`, a unique `request_id`, `job_id`, `command_type`, `callback_url`, and typed payload.

Every callback uses `WorkerCallback` with a unique `callback_id`, matching `request_id`, matching `job_id`, exact `result_type`, and typed payload.

Retries follow these rules:

1. A repeated command keeps the same `request_id`.
2. Agent B returns the saved result and does not repeat work.
3. A repeated callback keeps the same `callback_id`.
4. Agent B signs the raw callback body with `WORKER_CALLBACK_SECRET`, a timestamp, and HMAC-SHA256.
5. A callback transport failure does not repeat capture, Terac task creation, or Replay execution.

### Artifacts

Agent B writes only private Supabase objects. It returns object paths, not permanent URLs.

```text
jobs/<job_id>/capture/desktop.png
jobs/<job_id>/capture/mobile.png
jobs/<job_id>/capture/full-page.png
jobs/<job_id>/capture/dom.json
jobs/<job_id>/capture/accessibility.json
jobs/<job_id>/capture/styles.json
jobs/<job_id>/capture/navigation.json
jobs/<job_id>/capture/console.json
jobs/<job_id>/capture/network-errors.json
jobs/<job_id>/capture/scout/evidence-v1.json
jobs/<job_id>/capture/replay/findings-v1.json
jobs/<job_id>/spec/paywall-spec-v1.json
jobs/<job_id>/variants/manifest-v1.json
jobs/<job_id>/variants/quality-summary-v1.json
jobs/<job_id>/variants/a/*
jobs/<job_id>/variants/b/*
jobs/<job_id>/study/metrics-v1.json
jobs/<job_id>/reports/report-input-v1.json
```

Each JSON artifact contains `contract_version`, `job_id`, `created_at`, and `checksum`.

### Local adapters

Create one internal interface and two adapters for each external boundary:

| Interface | Production adapter | Local adapter |
| --- | --- | --- |
| `CallbackAdapter` | Signed POST to Agent A's `callback_url` | Mock Agent A receiver |
| `ArtifactStore` | Private Supabase Storage | Temporary local directory |
| `BrowserSandbox` | Superserve sandbox | Local Playwright process |
| `ModelAdapter` | Anthropic structured output | Fixed valid and invalid fixtures |
| `TeracAdapter` | Terac task and submission API | File-backed submissions |
| `ReplayAdapter` | Replay QA | Fixed passed and failed findings |

Implement `executeWorkerCommand(command, adapters)` in `apps/worker`.

It must:

1. validate the shared command;
2. reject a mismatched contract version or `job_id`;
3. find an existing `request_id` before work starts;
4. create an `agent_runs` record before an external side effect;
5. call the matching handler;
6. store and checksum all artifacts;
7. validate the shared callback;
8. save `callback_id` before sending;
9. sign and send the callback;
10. reuse the saved result on retry.

The mock Agent A receiver lives in `tests/workstream-b/mocks/agent-a.ts`. It verifies the HMAC and timestamp. It stores one callback per `callback_id` and matches each callback to `request_id`.

### Ordered tasks

#### 1. Create the worker shell

Create the owned packages, route handlers, adapter interfaces, local mocks, and command dispatcher. Load shared fixtures without changing them. Put new fixtures in `tests/workstream-b/fixtures/**`.

Checkpoint: every shared command reaches the correct empty handler. Every shared callback reaches the mock Agent A receiver.

#### 2. Implement safe Superserve capture

Apply the Stage 1 rules to the main page, redirects, iframes, and subresources.

The URL guard must:

1. allow only `http:` and `https:`;
2. reject embedded credentials and invalid hosts;
3. resolve all A and AAAA records;
4. reject private, loopback, link-local, multicast, reserved, unspecified, and metadata addresses;
5. reject alternate numeric IP forms and blocked IPv4-in-IPv6 addresses;
6. repeat validation after each redirect;
7. use a sandbox egress rule that blocks private and metadata networks after DNS validation;
8. stop after five redirects, 30 seconds, or 20 MB;
9. block downloads, pop-ups, external protocols, and permission prompts.

The browser can follow public pricing and checkout navigation. It must stop before an account, trial, order, or charge is created. It never uses credentials.

Write all capture artifacts before returning. A public fixture must succeed. A private address and a public-to-private redirect must fail before navigation.

#### 3. Extract `BrandSpec` and `PaywallSpec`

Use Stages 2 through 4. The model receives screenshots and reduced DOM evidence. It returns JSON only.

Keep `BrandSpec` inside `PaywallSpec.brand`. Each extracted value stores its source URL, selector or screenshot region, timestamp, and confidence.

Lock prices, billing intervals, trial terms, guarantees, legal text, and product claims. Reject a locked fact without evidence.

For `mode: "automatic"`:

- return `spec_ready` after a valid high-confidence specification;
- return `needs_scout` and create one scout task when confidence is low;
- return `failed` for an unsafe or unusable capture.

For `mode: "with_scout_evidence"`, read the supplied `scout_evidence_path`, merge it with automatic evidence, and run every check again.

Checkpoint: the same fixture produces the same normalized specification and checksum twice. A low-confidence fixture creates one scout task.

#### 4. Implement the Terac scout

Implement `GET /scout/:token` and `POST /api/scout/:token`. Show the exact task from **Terac scout fallback** without shortening it.

Use a signed, opaque, expiring token. Store only its hash. The form requires:

- final public URL;
- at least one click step;
- one full-page PNG, JPEG, or WebP image;
- visible offer text when present;
- blocker text and an image when access fails.

Limit each image to 10 MB. Remove image metadata. Reject HTML, SVG, archives, executable files, and false content types.

Write accepted evidence to `jobs/<job_id>/capture/scout/evidence-v1.json`. Create a deterministic `PB-SCOUT-` code from the scout task ID and `APP_SIGNING_SECRET`. Store only its HMAC hash.

Send `ScoutEvidenceAccepted` once. It uses the original capture `request_id` and a new `callback_id`. Agent A then sends a new scout-backed `CaptureJobRequest`.

Checkpoint: incomplete evidence returns no code. Complete evidence returns one safe retryable code and one callback. A code can validate one Terac submission only.

#### 5. Build deterministic variants

Validate `VariantBuildRequest` and the private `paywall_spec_path`. Check the specification checksum.

1. Render A from the approved Stage 6 components.
2. Pass A fidelity before generating B.
3. Generate one `ChangePlan` from one allowed Stage 5 hypothesis.
4. Reject changes to locked facts.
5. Apply only approved component operations.
6. Render B with the same source facts.
7. Bundle no source-site script or tracker.
8. Write the manifest, pages, screenshots, and quality summary.

`manifest-v1.json` locks the source checksum, renderer version, hypothesis, facts, operations, variant IDs, artifact checksums, simulation version, and event version.

A repeated `request_id` must return the stored model result, manifest, and checksums. For a stored `PaywallSpec` and `ChangePlan`, the renderer must produce the same page checksums.

#### 6. Run quality gates

Run the Stage 8 gates. Block publication on:

- invalid schemas or changed facts;
- poor A fidelity;
- broken desktop or mobile layout;
- failed keyboard completion;
- critical or serious axe-core failures;
- broken completion or stop flows;
- wrong event emission;
- console errors or unexpected external requests.

Retry only B's failed operation. Stop after two attempts. Return `VariantBuildResult: variants_ready` only when A and B pass. Return the IDs, preview paths, study URL, manifest path, and quality path.

Checkpoint: valid pages pass. Changed-price, external-script, inaccessible, and broken-form fixtures fail the correct gate.

#### 7. Start the blinded Terac study

Validate `StudyStartRequest`, the manifest checksum, both preview checks, sample limits, simulated budget, balanced assignment, and primary metric.

Create one Terac task with the exact neutral copy in [01-product.md](./01-product.md#terac-job-2-blinded-end-user-purchase-task). Replace every placeholder. Open the link once in a private browser before recruitment.

The job text must not contain `A/B`, `control`, `challenger`, `variant`, `experiment`, or `comparison`.

Send `StudyStarted: started` after the study row and Terac task exist. A repeated request must not create another Terac task.

#### 8. Assign one page per end-user

Implement `GET /s/:token`.

1. Validate the signed opaque token and expiry.
2. Reuse the secure session cookie when present.
3. Otherwise, open a serializable database transaction.
4. Create a random order of `A, A, B, B` for each block of four.
5. Insert one `assigned_variant_id` before rendering.
6. Commit and set a Secure, HTTP-only, SameSite=Lax cookie.
7. Render one page without returning its A or B label.

Use a database lock or serializable transaction. Concurrent users must not claim the same assignment slot. Refreshing must keep the same page.

The page shows the simulation notice, budget, fake identity, fake address, fake payment token, `Complete simulated purchase`, and `I would stop here`. It never accepts a real card number.

Checkpoint: eight new sessions receive four A and four B assignments. Refreshes do not change them.

#### 9. Record behavior, decision, survey, and code

`POST /api/studies/:id/events` must authenticate the session and validate the shared event contract. It rejects:

- a mismatched study or variant;
- an unknown event name;
- a duplicate or decreasing sequence number;
- unknown metadata or typed field values;
- an event after completion;
- a rate-limit violation.

`POST /api/studies/:id/decision` accepts one shared `ParticipantDecision`. It requires all six Stage 10 answers and scores from 1 through 5. It saves the decision, feedback, and completion state in one transaction.

Create a deterministic `PB-` code from `participant_session_id` and `APP_SIGNING_SECRET`. Store only its HMAC hash. A safe response retry returns the same code. One code validates one Terac submission.

Never log card data, fake identity fields, survey text, raw tokens, or raw codes.

Checkpoint: both decisions receive a code. A second decision fails. Duplicate events cause no duplicate record.

#### 10. Validate human evidence

The Terac adapter joins a submission to a server session by completion-code hash.

Mark a session `valid` only when the assigned page loaded, the assignment stayed fixed, required events exist, the survey is complete, minimum time passed, no blocking technical error occurred, and the code is valid and unused.

Mark empty, copied, contradictory, or too-fast responses `flagged`. Mark page crashes, missing artifacts, and network failures `technical_failure`. Technical failures never count as refusals.

Stop at the target valid sample. Return `insufficient_sample` if either group stays below `minimum_valid_per_variant` when recruitment closes.

#### 11. Analyze and create report input

Calculate the primary metric for A and B:

```text
valid complete_simulated_purchase sessions / all valid decision sessions
```

Exclude technical failures. Also calculate time, validation errors, backtracks, clarity, trust, offer accuracy, price accuracy, continuation intent, hesitation themes, and technical-failure rate.

Use these locked result rules:

1. Fewer than the minimum valid sessions on either page gives `insufficient_sample` and `no_clear_winner`.
2. B wins when its primary rate is at least 10 percentage points higher and neither median clarity nor trust falls by more than 0.5.
3. A wins under the same rule in the other direction.
4. Every other result is `no_clear_winner`.
5. Never claim statistical significance from this sample.

Write `metrics-v1.json` with formulas, denominators, exclusions, aggregates, and the applied rule.

Write `report-input-v1.json` with specification and manifest checksums, screenshots, hypothesis, exact changes, sample counts, exclusions, metrics, guardrails, counted participant themes, limitations, result, and recommended action.

Do not include phone numbers, Terac IDs, raw codes, or payment data. Do not render `final.html`.

Send one terminal `StudyResult` with `metrics_path` and `report_input_path`.

Checkpoint: repeated analysis returns the same result and checksums. The shared no-winner fixture stays `no_clear_winner`.

#### 12. Run Replay QA

Validate `ReplayQaRequest` and all input checksums. Test A and B on desktop and mobile. Cover completion, stop, survey errors, event retry, refresh assignment, expired tokens, one-use codes, console errors, and network failures.

Write de-identified findings to `jobs/<job_id>/capture/replay/findings-v1.json`.

Return `ReplayQaResult: passed` only when no blocking finding remains. Include `replay_run_url` when available. Return `failed` with `REPLAY_QA_FAILED` for a blocking finding.

Replay must not record secrets, raw tokens, raw codes, or survey free text.

### Failure cases

| Failure | Required result |
| --- | --- |
| Invalid command or contract version | `INVALID_WORKER_COMMAND` |
| Unsafe URL or redirect | `CaptureJobResult: failed`, `UNSAFE_URL` |
| Capture timeout | Retry once, then `needs_scout`, `CAPTURE_TIMEOUT` |
| No reliable paywall | `needs_scout`, `PAYWALL_NOT_FOUND` |
| Low confidence | `needs_scout`, `CAPTURE_LOW_CONFIDENCE` |
| Invalid scout evidence | No callback or code, `SCOUT_EVIDENCE_INVALID` |
| Invalid model output | Retry once, then `MODEL_SCHEMA_INVALID` |
| Changed locked fact | `VariantBuildResult: failed`, `SOURCE_FACT_MISMATCH` |
| A fidelity failure | `VariantBuildResult: failed`, `CONTROL_FIDELITY_FAILED` |
| B fails twice | `VariantBuildResult: failed`, `CHALLENGER_QUALITY_FAILED` |
| Invalid study token | Safe 404, `STUDY_TOKEN_INVALID` |
| Assignment changes | Reject session, `ASSIGNMENT_CONFLICT` |
| Invalid event | Reject event, `EVENT_INVALID` |
| Second decision | Keep first result, `DECISION_ALREADY_RECORDED` |
| Too few valid sessions | `StudyResult: insufficient_sample`, `no_clear_winner` |
| Corrupt study data | `StudyResult: failed`, `STUDY_DATA_INVALID` |
| Blocking Replay finding | `ReplayQaResult: failed`, `REPLAY_QA_FAILED` |
| Callback unavailable | Retry the same callback without repeating work |

### Required tests

Unit tests cover schemas, HMAC, idempotency, URL safety, extraction, locked facts, deterministic rendering, assignments, event sequences, decisions, codes, metrics, guardrails, and de-identification.

Integration tests cover automatic capture, scout fallback, scout-backed capture, variant building, study start, A and B sessions, insufficient sample, Replay pass and failure, duplicate requests, duplicate submissions, private artifacts, and token expiry.

Browser tests cover A and B on desktop and mobile, keyboard use, both decisions, required survey errors, stable assignment, blocked real-card input, axe-core, console errors, and unexpected requests.

The final mock test runs this complete sequence:

```text
CaptureJobRequest
-> CaptureJobResult: needs_scout
-> valid scout form
-> ScoutEvidenceAccepted
-> scout-backed CaptureJobRequest
-> CaptureJobResult: spec_ready
-> VariantBuildRequest
-> VariantBuildResult: variants_ready
-> StudyStartRequest
-> StudyStarted
-> valid A, B, stop, and technical-failure sessions
-> StudyResult
-> ReplayQaRequest
-> ReplayQaResult: passed
```

Assert exact artifact paths, checksums, callback order, request matching, one side effect per request, and no secret values.

### Definition of done

Workstream B is complete when:

1. Agent B changed only its owned paths.
2. All shared commands and callbacks use contract version `1` schemas.
3. Commands and callbacks are idempotent.
4. Safe capture blocks private and metadata networks.
5. Automatic and scout-backed capture produce auditable evidence.
6. `PaywallSpec` contains sourced facts and `BrandSpec` values.
7. A and B are deterministic, functional, and collect no real payment data.
8. Both pages pass all blocking quality gates.
9. The existing scout and blinded Terac tasks are copy-ready and tested once.
10. Each end-user sees one stable page only.
11. Server checks validate events, decisions, surveys, and one-use codes.
12. Technical failures do not count as refusals.
13. Metrics and report input match the shared artifact contract.
14. Replay passes all required journeys.
15. Unit, integration, browser, contract, and full mock tests pass.
16. Type-checking and the production build pass.
17. The full mock journey passes while Agent A is unavailable.

After this workstream passes, final integration replaces only the local adapters. It does not change the shared contract.
