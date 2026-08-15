# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js and TypeScript on Vercel, Supabase for durable data and artifacts, Superserve for isolated browser workers, Anthropic for structured page understanding, and sponsor adapters for Stripe, Linq, Terac, and Replay.

## Users

The primary product user is the PayBench operator. They select one founder and watch that founder's paid test move from URL intake to report delivery.

Founders use Linq and Stripe. Terac scouts and study participants use separate, signed task pages. Neither group can open the operator dashboard.

## Product Purpose

PayBench turns one public checkout or paywall URL into a private, blinded usability study. It captures the original, builds one controlled alternative, recruits real end-users for simulated purchase decisions, checks both pages, and delivers a directional result.

Success means one real founder pays $20 and PayBench completes the full workflow with auditable evidence.

## Positioning

PayBench combines a real founder payment, isolated browser work, a brand-matched controlled challenger, blinded human purchase-intent evidence, and technical QA in one observable run.

## Operating Context

The operator uses the dashboard during a time-sensitive hackathon. One selected run is the unit of work. The operator needs to see payment, capture, both Superserve sandboxes, Terac recruitment, participant validity, Replay QA, report creation, delivery, blockers, and artifacts without opening logs first.

## Capabilities and Constraints

- The founder's Stripe payment is real. Participant money and checkout are simulated.
- The system recreates private research pages. It does not edit the founder's live website.
- Each Terac participant sees only A or B and is not told that another page exists.
- Results are directional and never claim statistical significance from the small sample.
- The dashboard is internal-only and must not expose sponsor secrets, participant codes, phone numbers, payment data, or survey free text.
- The MVP uses two Superserve sandbox views: A reproduces the source paywall and B applies one controlled change.
- Replay QA starts after the measured study and checks both generated pages before delivery.
- Render and Pioneer are outside the product.

## Brand Commitments

The product name is PayBench. The interface is modular, direct, and low-copy. Instagram is a usability reference for recognizable navigation and self-explanatory controls, not a visual clone. Generic AI-dashboard styling, verbose helper text, identical card grids, and default SaaS typography are rejected.

## Evidence on Hand

The three files in `docs/` define the product flow, paywall engine, shared contracts, sponsor roles, and implementation boundaries. Demonstration run data is synthetic until the real adapters and first paid run are connected; the interface must label it as demo data.

## Product Principles

1. Show the run, not a summary of the run.
2. Keep one founder and one job in focus.
3. Make every external action traceable to a time, actor, and artifact.
4. Use short labels and familiar controls.
5. Separate real payments, simulated purchases, and technical failures.

## Accessibility & Inclusion

The web dashboard supports keyboard navigation, visible focus, readable contrast, reduced motion, semantic status text in addition to color, and responsive layouts down to a narrow mobile viewport.
