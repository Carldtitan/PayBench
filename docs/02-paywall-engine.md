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

The scout receives the public URL and a short instruction:

1. Open the website.
2. Reach the checkout or paywall without purchasing.
3. Upload desktop and mobile screenshots.
4. Record the clicks used to reach it.
5. Copy visible plan names, prices, CTA text, and legal text.
6. State whether login or location blocked access.

The scout does not paste passwords, card data, or private account information.

The worker merges the scout evidence into the same `PaywallSpec`. The rest of the pipeline stays unchanged.

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

PayBench creates short-lived signed preview URLs for participants. It stores the sandbox ID in Supabase, so another process can reconnect after a pause.

Each participant URL contains opaque values:

- `study_token`;
- `participant_token`;
- `order` of A and B.

These values contain no phone number, email, or secret.

## Stage 10: simulated checkout

The checkout UI shows a clear simulation notice. PayBench supplies:

- a fake customer name;
- a fake billing address;
- a fixed fake payment token;
- a task-specific purchase goal.

The participant can complete the flow without typing a card number. The final action says `Complete simulated purchase`, not `Pay now`.

The telemetry endpoint accepts only approved event names. It rate-limits each participant token and rejects events after completion.

## Stage 11: human evidence quality

PayBench rejects or flags a participant session when:

- the assigned page never loaded;
- the participant completed too quickly to view the offer;
- required event checkpoints are missing;
- the written reason is empty or copied;
- the same participant token is reused;
- the participant reports a technical failure;
- A and B were not shown in the assigned order.

Technical failures do not count as conversion failures. They go to the Replay and engineering queue.

## Stage 12: analysis and report

The analysis joins event data and Terac responses by participant token. It calculates:

- completion difference;
- median time difference;
- error and backtrack difference;
- clarity and trust difference;
- first-view versus second-view effects;
- preference count;
- recurring reasons;
- technical-failure rate.

The report contains screenshots, the exact change, the evidence, limitations, and a recommendation. It never hides the sample size.

