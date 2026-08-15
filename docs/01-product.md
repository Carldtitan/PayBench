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
13. Each Terac end-user receives one randomly assigned page and completes a simulated purchase task.
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

## Terac job 2: blinded end-user purchase task

PayBench posts one neutral Terac job and gives every end-user the same `{{STUDY_URL}}`. The job does not use the terms A/B test, control, challenger, experiment, or comparison. The server assigns one page after the end-user opens the link. The end-user never sees the other page.

Copy this text into the Terac job:

> **Title:** Decide whether to complete a simulated online purchase
>
> **Your role:** Act as an end-user who is considering buying the product shown on the page.
>
> **Your situation:** You have a simulated budget of **{{SIMULATED_BUDGET}}**. This is not real money. You will not be charged, and you must not enter a real card number.
>
> **Start here:** `{{STUDY_URL}}`
>
> **Task:** Open the link and review the offer as if the simulated budget were your own. If you would buy, choose an option and complete the simulated purchase with the fake information shown on the page. If you would not continue, click **I would stop here** at the point where you decide to stop. Do not complete the purchase only because this task asks you to review it.
>
> **After your decision:** Answer every question on the page. PayBench gives you a completion code whether you buy or stop. When you finish, copy the code that starts with `PB-` into your Terac submission.
>
> **Do not:** use real payment information, spend real money, open the target company's live checkout in another tab, refresh to get a different page, or discuss this task with another participant.
>
> **Your Terac submission must contain:** the `PB-` completion code and one sentence describing anything that made you hesitate.
>
> **The task is complete only when:** you have chosen either **Complete simulated purchase** or **I would stop here**, answered all questions, and pasted the valid `PB-` code into Terac.

Example participant scenario:

> You have $100 of simulated money to choose a plan for a tool you may use at work. Review the offer and complete the simulated purchase if the product and terms make sense to you. If you would not continue with real money, choose **I would stop here** where you naturally would and explain why. You will still receive a completion code after answering the questions.

PayBench records:

- page viewed;
- first interaction time;
- clicks and misclicks;
- field focus and correction count;
- back navigation;
- checkout completion;
- completion time;
- final clarity and trust ratings;
- what the end-user believed they were buying;
- the price and billing terms they understood;
- what made them hesitate;
- whether they would continue with real money, and why.

PayBench does not store typed card data. The simulated card control accepts only a fixed fake token.

## How the A/B test actually runs

This is a blinded, between-groups test:

1. Terac gives every end-user the same neutral job and `{{STUDY_URL}}`.
2. On first open, PayBench creates one participant session.
3. The server assigns that session to A or B using shuffled blocks: every block of four assignments contains two A and two B in random order.
4. The assignment is saved before the page loads. Refreshing keeps the same page.
5. Each end-user sees one page only. They cannot compare pages and are not told that another page exists.
6. Both groups receive the same scenario, simulated budget, fake details, time limit, and survey.
7. PayBench records behavior on the assigned page and generates a one-use `PB-` completion code after the task and survey.
8. The end-user pastes that code into Terac. PayBench accepts a result only when the code matches a real server session and has not been used before.

The target is 20 valid end-users: 10 on A and 10 on B. The minimum usable result is six valid sessions per page. A smaller sample gives directional evidence only; PayBench does not claim statistical significance.

Before recruitment starts, PayBench locks the simulated-purchase decision rate as the primary metric: `Complete simulated purchase` versus `I would stop here`. Completion time, errors, backtracks, clarity, and trust are secondary metrics. This prevents choosing a winner only because one after-the-fact number looks better.

The completion code proves that the end-user loaded the assigned page, made a decision, and answered the questions. It does not prove that the person would spend real money. The random assignment makes the two simulated groups comparable, but the report must describe the result as usability and purchase-intent evidence, not a measured revenue lift.

## Result rules

PayBench does not declare a winner from preference alone.

The result uses four groups of evidence:

1. simulated-purchase decision rate;
2. completion time and interaction errors;
3. trust and clarity ratings;
4. participant explanations.

The challenger wins only when it improves the simulated-purchase decision rate without failing a guardrail. Guardrails include trust, clarity, accessibility, and technical errors.

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
