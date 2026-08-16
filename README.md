# PayBench

PayBench helps founders improve their paywall and catch payment journey bugs before customers see them.

A paywall is the page where a customer chooses and pays for a plan. PayBench takes a public pricing or checkout page, recreates it, builds one focused alternative, tests both versions, and collects feedback from target customers. The founder receives a clear recommendation about which version is stronger and what should change.

## The problem

Founders who sell subscription products often design their paywall based on guesses. They may not know which message, layout, or plan presentation will help more customers buy. They can also lose customers because of broken buttons, confusing forms, mobile problems, or failed checkout steps.

PayBench solves both problems. It helps the founder find a stronger paywall and confirms that the complete journey works correctly.

## How PayBench works

The founder starts a conversation through Linq. They send their paywall URL and describe the customers they want to reach. Stripe collects the real $20 PayBench service fee and confirms the payment through a signed webhook.

Superserve opens the submitted website inside an isolated cloud computer. Anthropic converts the captured page into structured information about the product, plans, prices, terms, and design. Superserve then builds two interactive research websites with real code. Version A recreates the original paywall. Version B applies one controlled change that could improve conversion. PayBench never edits the founder's live website.

Replay runs Playwright journeys against both versions before human testing begins. It checks buttons, forms, plan selection, mobile layouts, validation, and checkout steps. A failed or missing Replay run blocks the study until the problem is fixed.

Terac recruits ten people who match the founder's target customer. Five people receive Version A, and five receive Version B. Each person sees only one version. PayBench records what they understand, what they click, where they stop, and whether they would continue.

PayBench compares customer behavior, technical errors, clarity, trust, and written feedback. The result can favor Version A, favor Version B, show no clear signal, or report insufficient evidence. Linq sends the final report to the founder.

```text
Linq intake -> Stripe payment -> Superserve capture -> Anthropic analysis -> Superserve A and B -> Replay QA -> Terac study -> PayBench report -> Linq delivery
```

## What is paid and what is simulated

The founder's $20 Stripe payment is real. In a live study, each approved Terac participant receives a real $5 reward. The participant reward is the same whether the person continues or stops.

Only the purchase shown inside the research paywall is simulated. The research page does not charge the participant or create a real subscription. This keeps the purchase decision realistic without asking participants to buy the founder's product.

## Sponsor integrations

### Linq

Linq is the founder's two way control channel. Signed Linq webhooks bring incoming messages into PayBench. The conversation collects the URL and target customer, sends the Stripe link, requests approvals, reports progress, and delivers the result. Linq is not a notification add on. It lets the founder run the service through one conversation.

### Stripe

Stripe collects the real $20 service fee through one approved Payment Link. PayBench adds the job ID as `client_reference_id`. A signed Stripe webhook connects the completed payment to the correct job and starts the workflow exactly once.

### Superserve

Superserve runs the capture and build workers inside isolated Firecracker microVMs. Each microVM is a small cloud computer with its own files, dependencies, processes, and network controls. Superserve creates real interactive pages, not screenshots. It also publishes protected preview URLs for Replay and the PayBench operator.

### Replay

Replay records Playwright tests inside Replay Chromium. Each recording preserves browser events, page state, console errors, network requests, and JavaScript activity. PayBench uses this evidence to find the cause of failures. Replay acts as a release gate, so a broken page cannot produce misleading customer research.

### Terac

Terac provides the screened participants who supply human purchase decisions. Every participant receives the same neutral study link. PayBench saves the participant's Version A or Version B assignment before the page loads. The study opens with one participant per version, then opens the remaining eight places after both pilot sessions succeed.

## Supporting infrastructure

Supabase stores jobs, workflow state, assignments, events, approvals, and report artifacts. Anthropic turns page evidence into a strict paywall specification and one limited change plan. Vercel hosts the Next.js application and provides the public HTTPS routes required by sponsor webhooks and signed reports.

## Why the result matters

PayBench does not call a version better because people say it looks nicer. It uses simulated purchase decisions, completion time, interaction errors, clarity, trust, and written explanations. A version only produces a stronger signal when it improves the main decision without harming important safeguards.

The ten person study provides directional evidence. It does not claim statistical significance or guaranteed revenue growth.

## How PayBench could scale

With $1 million in funding, PayBench would become an agent run testing company for teams that sell subscription products. Software agents would manage capture, page creation, quality checks, participant coordination, analysis, and delivery. Humans would provide real purchase decisions and handle unusual cases.

The company would offer automated paywall quality checks, human comparison studies, and continuous monitoring after launch. Funding would support engineering, browser infrastructure, participant quality, customer growth, security, legal work, and support.

## Technical stack

PayBench is a TypeScript monorepo. The web application uses Next.js and runs on Vercel. Supabase provides durable data and artifact storage. Superserve provides isolated browser and code workers. Anthropic creates structured page specifications. Stripe, Linq, Replay, and Terac connect through narrow adapters and signed workflow events.

## Run locally

Install the workspace dependencies.

```bash
npm install
```

Copy `.env.example` to `.env`, then add only the credentials required for the services you use. Never commit `.env` or place secret keys in client side variables.

Start the Next.js development server.

```bash
npm run dev
```

Run the standard checks before committing changes.

```bash
npm run typecheck
npm test
npm run build
```

Replay tests use a separate command and require a Replay Test Suite API key.

```bash
npm run test:replay
```

## Current development mode

The repository keeps Terac in mock mode with `TERAC_MODE=mock` and `TERAC_LIVE_DISABLED=true`. The application cannot create or publish a live Terac opportunity in this mode. Live recruitment must remain disabled until the full workflow, previews, Replay checks, operator approvals, and reward quote are verified.

Demo data must always be labeled as demo data. The operator dashboard must never expose API keys, card data, phone numbers, participant assignments, completion codes, or private survey responses.

## Project documentation

The product definition is in [`docs/01-product.md`](docs/01-product.md). The paywall engine design is in [`docs/02-paywall-engine.md`](docs/02-paywall-engine.md). The system design and setup guide is in [`docs/03-system-design-and-setup.md`](docs/03-system-design-and-setup.md).
