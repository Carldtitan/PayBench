import "./server-only";

import {
  dashboardRunSnapshotSchema,
  type DashboardRunSnapshot,
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

export type TeracStudyState = DashboardRunSnapshot["study"];

export interface TeracStudySource {
  readStudy(jobId: string): Promise<TeracStudyState>;
}

const teracStudyStateSchema = dashboardRunSnapshotSchema.shape.study;

export class TeracStatusAdapter
  implements SponsorStatusAdapter<TeracStudyState>
{
  constructor(
    private readonly stateSource: TeracStudySource,
    private readonly source: IntegrationSource = "live",
    private readonly clock: Clock = () => new Date(),
  ) {}

  async read(jobId: string): Promise<IntegrationRead<TeracStudyState>> {
    assertJobId(jobId);
    const observed_at = observedAt(this.clock);
    const record = await this.stateSource.readStudy(jobId);
    const state = teracStudyStateSchema.parse({
      target: record.target,
      valid: record.valid,
      a_valid: record.a_valid,
      b_valid: record.b_valid,
      flagged: record.flagged,
      rejected: record.rejected,
      technical_failures: record.technical_failures,
    });

    if (state.valid !== state.a_valid + state.b_valid) {
      throw new SponsorStatusError("TERAC_VALID_COUNT_MISMATCH");
    }

    return { source: this.source, observed_at, state };
  }
}
