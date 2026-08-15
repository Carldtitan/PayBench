import "./server-only";

import {
  sandboxLiveStateSchema,
  type SandboxLiveState,
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

export type SuperserveViews = readonly [SandboxLiveState, SandboxLiveState];

export interface SuperserveViewRecord {
  variant: SandboxLiveState["variant"];
  sandbox_id: string;
  status: SandboxLiveState["status"];
  task: string;
  viewer?: ExpiringLink;
  preview?: ExpiringLink;
  latest_frame?: ExpiringLink;
  last_activity_at: string;
}

export interface SuperserveStateSource {
  /**
   * A live implementation must reconnect by sandbox ID and call getInfo() for
   * fresh lifecycle data. It must not read the SDK instance.status snapshot.
   *
   * preview must come from a private published port and
   * getSignedPreviewUrl(expiresInSeconds). viewer, when present, is a
   * PayBench-owned observer page. It is not a constructed Superserve data-plane
   * or shell URL. latest_frame is an expiring, read-only image link.
   */
  readViews(jobId: string): Promise<readonly SuperserveViewRecord[]>;
}

export class SuperserveStatusAdapter
  implements SponsorStatusAdapter<SuperserveViews>
{
  constructor(
    private readonly stateSource: SuperserveStateSource,
    private readonly source: IntegrationSource = "live",
    private readonly clock: Clock = () => new Date(),
  ) {}

  async read(jobId: string): Promise<IntegrationRead<SuperserveViews>> {
    assertJobId(jobId);
    const observed_at = observedAt(this.clock);
    const records = await this.stateSource.readViews(jobId);

    if (records.length !== 2) {
      throw new SponsorStatusError("SUPERSERVE_REQUIRES_TWO_VIEWS");
    }

    const mapped = records.map((record) =>
      sandboxLiveStateSchema.parse({
        variant: record.variant,
        sandbox_id: record.sandbox_id,
        status: record.status,
        task: record.task,
        viewer_url: activeHttpsUrl(record.viewer, observed_at),
        preview_url: activeHttpsUrl(record.preview, observed_at),
        latest_frame_url: activeHttpsUrl(record.latest_frame, observed_at),
        last_activity_at: record.last_activity_at,
      }),
    );

    const a = mapped.find((view) => view.variant === "A");
    const b = mapped.find((view) => view.variant === "B");

    if (!a || !b) {
      throw new SponsorStatusError("SUPERSERVE_REQUIRES_A_AND_B");
    }

    return { source: this.source, observed_at, state: [a, b] };
  }
}
