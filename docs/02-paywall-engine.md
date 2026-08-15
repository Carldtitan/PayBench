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
