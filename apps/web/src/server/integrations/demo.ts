import "./server-only";

import { LinqStatusAdapter } from "./linq";
import { ReplayStatusAdapter } from "./replay";
import { StripeStatusAdapter } from "./stripe";
import { SuperserveStatusAdapter } from "./superserve";
import { TeracStatusAdapter } from "./terac";
import type { Clock } from "./types";

export interface DemoSponsorStatusAdapters {
  superserve: SuperserveStatusAdapter;
  replay: ReplayStatusAdapter;
  stripe: StripeStatusAdapter;
  terac: TeracStatusAdapter;
  linq: LinqStatusAdapter;
}

export function createDemoSponsorStatusAdapters(
  clock: Clock = () => new Date(),
): DemoSponsorStatusAdapters {
  const now = clock();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const expiring = (path: string) => ({
    url: `https://demo.paybench.invalid/${path}?demo=1`,
    expires_at: expiresAt,
  });

  return {
    superserve: new SuperserveStatusAdapter(
      {
        async readViews() {
          return [
            {
              variant: "A" as const,
              sandbox_id: "demo-sandbox-a",
              status: "ready" as const,
              task: "Source paywall is ready",
              viewer: expiring("sandbox/a/viewer"),
              preview: expiring("sandbox/a/preview"),
              latest_frame: expiring("sandbox/a/latest-frame.png"),
              last_activity_at: nowIso,
            },
            {
              variant: "B" as const,
              sandbox_id: "demo-sandbox-b",
              status: "validating" as const,
              task: "Checking the controlled change",
              viewer: expiring("sandbox/b/viewer"),
              preview: expiring("sandbox/b/preview"),
              latest_frame: expiring("sandbox/b/latest-frame.png"),
              last_activity_at: nowIso,
            },
          ];
        },
      },
      "demo",
      () => now,
    ),
    replay: new ReplayStatusAdapter(
      {
        async readReplay() {
          return {
            status: "checking" as const,
            current_journey: "Complete simulated purchase on B",
            completed_checks: 6,
            total_checks: 8,
            blocking_findings: 0,
            run: expiring("replay/run"),
            last_activity_at: nowIso,
          };
        },
      },
      "demo",
      () => now,
    ),
    stripe: new StripeStatusAdapter(
      { async readPayment() { return { paid: true, amount_paid_cents: 2000, currency: "USD" }; } },
      "demo",
      () => now,
    ),
    terac: new TeracStatusAdapter(
      {
        async readStudy() {
          return {
            target: 20,
            valid: 12,
            a_valid: 6,
            b_valid: 6,
            flagged: 1,
            rejected: 1,
            technical_failures: 1,
          };
        },
      },
      "demo",
      () => now,
    ),
    linq: new LinqStatusAdapter(
      { async readDelivery() { return { status: "waiting" as const }; } },
      "demo",
      () => now,
    ),
  };
}
