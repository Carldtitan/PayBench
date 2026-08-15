import "./server-only";

import {
  dashboardStageStatusSchema,
  type DashboardStageStatus,
} from "@paybench/contracts";
import {
  assertJobId,
  observedAt,
  SponsorStatusError,
  type Clock,
  type IntegrationRead,
  type IntegrationSource,
  type SponsorStatusAdapter,
} from "./types";

export interface LinqDeliveryState {
  status: DashboardStageStatus;
  timestamp?: string;
}

export interface LinqDeliverySource {
  readDelivery(jobId: string): Promise<LinqDeliveryState>;
}

export class LinqStatusAdapter
  implements SponsorStatusAdapter<LinqDeliveryState>
{
  constructor(
    private readonly stateSource: LinqDeliverySource,
    private readonly source: IntegrationSource = "live",
    private readonly clock: Clock = () => new Date(),
  ) {}

  async read(jobId: string): Promise<IntegrationRead<LinqDeliveryState>> {
    assertJobId(jobId);
    const observed_at = observedAt(this.clock);
    const record = await this.stateSource.readDelivery(jobId);
    const status = dashboardStageStatusSchema.parse(record.status);

    if (record.timestamp && Number.isNaN(new Date(record.timestamp).getTime())) {
      throw new SponsorStatusError("LINQ_TIMESTAMP_INVALID");
    }

    const state: LinqDeliveryState = {
      status,
      ...(record.timestamp ? { timestamp: new Date(record.timestamp).toISOString() } : {}),
    };

    return { source: this.source, observed_at, state };
  }
}
