# PayBench product definition

## Product in one sentence

PayBench turns a public checkout or paywall URL into a controlled A/B usability test with real participants.

## What the customer buys

The customer pays $20 for one website test. The test includes:

- a captured version of the current paywall;
- one brand-matched alternative;
- a simulated checkout on both versions;
- behavior data from Terac participants;
- written participant explanations;
- a winner, or a clear `no winner` result;
- a short report with the recommended changes.

The customer does not install a script. The customer does not prove domain ownership. PayBench tests private recreations of the submitted page. It does not change the live website.

## What is real and what is simulated

The customer's $20 Stripe payment is real. This payment counts as hackathon revenue.

The participant checkout is simulated. PayBench never asks a participant for a real card number. The test page states that no charge will occur.

## End-to-end customer flow

1. The founder texts the PayBench Linq number.
2. PayBench asks for the website or paywall URL.
3. PayBench creates a `job_id` and stores the conversation in Supabase.
4. PayBench confirms the site name and the $20 price.
5. PayBench sends the single approved Stripe Payment Link.
6. The link includes `client_reference_id=<job_id>`.
7. Stripe sends a signed webhook after payment.
8. PayBench marks the job as paid exactly once.
9. A Superserve worker opens the submitted website.
10. The worker captures the page and creates a structured paywall specification.
11. PayBench creates control A and challenger B.
12. Automated gates reject broken or off-brand pages.
13. Terac participants test both pages with simulated checkout data.
14. PayBench joins behavior events with participant explanations.
15. Replay tests the PayBench app and both generated pages.
16. PayBench creates the report.
17. Linq sends the report link to the founder.

Stripe supports `client_reference_id` on Payment Links. Stripe returns it in the completed-session webhook. It must contain no sensitive data. See [Stripe Payment Link tracking](https://docs.stripe.com/payment-links/url-parameters).

## Linq conversation

PayBench is inbound-first. It does not send cold outreach.

The first reply contains no link:

> I found Acme's pricing page. I can test its checkout against one improved version for $20. Reply YES to continue.

After the founder replies:

> Great. Pay here to start the test: [Stripe Payment Link]

This creates a real conversation and protects the Linq line. PayBench also:

- checks opt-out intent on every inbound message;
- never sends after `STOP` or a clear request to stop;
- lets Linq choose the sending line;
- stops reminders when the founder does not reply;
- verifies every Linq webhook with the raw request body.

## Participant test

Each participant receives a task such as:

> You are considering this product. Review the offer and continue until the final confirmation. No money will be charged.

The participant uses fake checkout data supplied by PayBench. PayBench records:

- page viewed;
- first interaction time;
- clicks and misclicks;
- field focus and correction count;
- back navigation;
- checkout completion;
- completion time;
- final clarity, trust, and purchase-confidence ratings;
- a required written reason.

PayBench does not store typed card data. The simulated card control accepts only a fixed fake token.

## Test design

Use a counterbalanced within-person test for the hackathon-sized sample:

- half of the participants see A then B;
- half see B then A;
- each version starts with clean local state;
- version labels are hidden;
- participants receive the same task and fake payment details;
- the report separates first-view behavior from stated preference.

This design gets more information from a small sample. The report must still state the sample size and uncertainty.

## Result rules

PayBench does not declare a winner from preference alone.

The result uses four groups of evidence:

1. task completion;
2. completion time and interaction errors;
3. trust and clarity ratings;
4. participant explanations.

The challenger wins only when it improves the primary metric without failing a guardrail. Guardrails include trust, clarity, accessibility, and technical errors.

If the evidence is mixed, PayBench reports `No clear winner`. It then recommends a narrower follow-up test.

## Sponsor roles

| Tool | Status | Essential job |
| --- | --- | --- |
| Terac | Required sponsor | Recruit participants and collect human judgments. |
| Stripe | Sponsor and revenue | Take the real $20 payment and confirm it by webhook. |
| Linq | Sponsor | Receive the URL, carry the conversation, send the payment link, and deliver the report. |
| Superserve | Sponsor | Run the capture and generation worker in an isolated persistent VM. |
| Replay | Sponsor | Find technical problems in PayBench and the generated pages. |
| Supabase | Required, not a sponsor | Store workflow state, events, memory, and report artifacts. |
| OpenAI | Required, not a sponsor | Convert page evidence into a strict paywall specification and a constrained change plan. |
| Vercel | Required, not a sponsor | Host the Next.js app on a public HTTPS URL for webhooks and reports. |

## What PayBench does not build for this hack

- no subscription;
- no live traffic routing on the founder's domain;
- no founder account system;
- no domain ownership check;
- no real participant charge;
- no dynamic price or discount invention;
- no arbitrary AI-generated JavaScript;
- no claim of statistical significance from a small sample.

## Definition of complete

The MVP is complete when one real founder can:

1. text a URL;
2. pay through the submitted Stripe link;
3. trigger a Superserve capture job;
4. receive working A and B pages;
5. get real Terac results;
6. receive a report through Linq;
7. see a clean Replay result after reported bugs are fixed.
