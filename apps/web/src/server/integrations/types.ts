import "./server-only";

import {
  dashboardRunSnapshotSchema,
  type DashboardRunSnapshot,
} from "@paybench/contracts";

export type IntegrationSource = DashboardRunSnapshot["source"];
export type Clock = () => Date;

export interface IntegrationRead<T> {
  source: IntegrationSource;
  observed_at: string;
  state: T;
}

export interface SponsorStatusAdapter<T> {
  read(jobId: string): Promise<IntegrationRead<T>>;
}

export class SponsorStatusError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SponsorStatusError";
    this.code = code;
  }
}

export function assertJobId(jobId: string): void {
  const result = dashboardRunSnapshotSchema.shape.job_id.safeParse(jobId);

  if (!result.success) {
    throw new SponsorStatusError("INVALID_JOB_ID");
  }
}

export function observedAt(clock: Clock): string {
  const value = clock();

  if (Number.isNaN(value.getTime())) {
    throw new SponsorStatusError("INVALID_OBSERVED_AT");
  }

  return value.toISOString();
}
