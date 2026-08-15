import "./server-only";

import {
  replayLiveStateSchema,
  type ReplayLiveState,
} from "@paybench/contracts";
import { activeHttpsUrl, type ExpiringLink } from "./safe-link";
import {
  assertJobId,
  observedAt,
  SponsorStatusError,
  type Clock,
  type IntegrationRead,
  type IntegrationSource,
  type SponsorStatusAdapter,
} from "./types";

export interface ReplayStateRecord {
  status: ReplayLiveState["status"];
  current_journey?: string;
  completed_checks: number;
  total_checks: number;
  blocking_findings: number;
  run?: ExpiringLink;
  last_activity_at?: string;
}

export interface ReplayStateSource {
  readReplay(jobId: string): Promise<ReplayStateRecord>;
}

export class ReplayStatusAdapter
  implements SponsorStatusAdapter<ReplayLiveState>
{
  constructor(
    private readonly stateSource: ReplayStateSource,
    private readonly source: IntegrationSource = "live",
    private readonly clock: Clock = () => new Date(),
  ) {}

  async read(jobId: string): Promise<IntegrationRead<ReplayLiveState>> {
    assertJobId(jobId);
    const observed_at = observedAt(this.clock);
    const record = await this.stateSource.readReplay(jobId);

    if (record.completed_checks > record.total_checks) {
      throw new SponsorStatusError("REPLAY_CHECK_COUNT_INVALID");
    }

    const state = replayLiveStateSchema.parse({
      status: record.status,
      current_journey: record.current_journey,
      completed_checks: record.completed_checks,
      total_checks: record.total_checks,
      blocking_findings: record.blocking_findings,
      run_url: activeHttpsUrl(record.run, observed_at),
      last_activity_at: record.last_activity_at,
    });

    return { source: this.source, observed_at, state };
  }
}
