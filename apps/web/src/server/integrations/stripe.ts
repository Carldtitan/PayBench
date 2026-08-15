import "./server-only";

import {
  dashboardRunSnapshotSchema,
  type DashboardRunSnapshot,
} from "@paybench/contracts";
import {
  assertJobId,
  observedAt,
  type Clock,
  type IntegrationRead,
  type IntegrationSource,
  type SponsorStatusAdapter,
} from "./types";

export type StripePaymentState = Pick<
  DashboardRunSnapshot,
  "paid" | "amount_paid_cents" | "currency"
>;

export interface StripePaymentSource {
  readPayment(jobId: string): Promise<StripePaymentState>;
}

const stripePaymentStateSchema = dashboardRunSnapshotSchema.pick({
  paid: true,
  amount_paid_cents: true,
  currency: true,
});

export class StripeStatusAdapter
  implements SponsorStatusAdapter<StripePaymentState>
{
  constructor(
    private readonly stateSource: StripePaymentSource,
    private readonly source: IntegrationSource = "live",
    private readonly clock: Clock = () => new Date(),
  ) {}

  async read(jobId: string): Promise<IntegrationRead<StripePaymentState>> {
    assertJobId(jobId);
    const observed_at = observedAt(this.clock);
    const record = await this.stateSource.readPayment(jobId);
    const state = stripePaymentStateSchema.parse({
      paid: record.paid,
      amount_paid_cents: record.amount_paid_cents,
      currency: record.currency.toUpperCase(),
    });

    return { source: this.source, observed_at, state };
  }
}
