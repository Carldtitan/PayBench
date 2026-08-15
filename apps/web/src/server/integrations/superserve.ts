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

export type SuperserveLifecycleStatus =
  | "active"
  | "paused"
  | "resuming"
  | "failed";

export type SuperserveActiveTaskStatus = Extract<
  SandboxLiveState["status"],
  "navigating" | "capturing" | "editing" | "validating" | "ready"
>;

export interface SuperserveSandboxInfo {
  id: string;
  status: SuperserveLifecycleStatus;
  createdAt: Date;
}

export interface SuperserveSdkSandbox {
  getInfo(): Promise<SuperserveSandboxInfo>;
  publishPreviewPort(
    port: number,
    options: { access: "private" },
  ): Promise<void>;
  getSignedPreviewUrl(
    port: number,
    options: { expiresInSeconds: number },
  ): Promise<string>;
}

export interface SuperserveSdkFactory {
  connect(sandboxId: string): Promise<SuperserveSdkSandbox>;
}

export interface SuperserveSandboxViewBinding {
  variant: SandboxLiveState["variant"];
  sandbox_id: string;
  task: string;
  active_status: SuperserveActiveTaskStatus;
  preview_port: number;
  /** Set this only when an authenticated PayBench viewer service is running. */
  viewer_port?: number;
  /** An expiring, read-only artifact URL supplied by the artifact store. */
  latest_frame?: ExpiringLink;
}

export const defaultSuperserveSdkFactory: SuperserveSdkFactory = {
  async connect(sandboxId) {
    // Keep the SDK behind the server-only adapter. The package is supplied by
    // the web workspace, while tests inject a factory and make no network call.
    const sdkPackageName: string = "@superserve/sdk";
    const sdk = (await import(sdkPackageName)) as {
      Sandbox?: { connect(id: string): Promise<SuperserveSdkSandbox> };
    };

    if (!sdk.Sandbox) {
      throw new SponsorStatusError("SUPERSERVE_SDK_UNAVAILABLE");
    }

    return sdk.Sandbox.connect(sandboxId);
  },
};

export function mapSuperserveLifecycleStatus(
  lifecycle: SuperserveLifecycleStatus,
  activeStatus: SuperserveActiveTaskStatus,
): SandboxLiveState["status"] {
  switch (lifecycle) {
    case "active":
      return activeStatus;
    case "paused":
      return "paused";
    case "resuming":
      return "booting";
    case "failed":
      return "failed";
  }
}

function assertPreviewPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || port === 49_983) {
    throw new SponsorStatusError("SUPERSERVE_PREVIEW_PORT_INVALID");
  }
}

export class SuperserveSdkStateSource implements SuperserveStateSource {
  constructor(
    private readonly bindings: readonly [
      SuperserveSandboxViewBinding,
      SuperserveSandboxViewBinding,
    ],
    private readonly sdk: SuperserveSdkFactory = defaultSuperserveSdkFactory,
    private readonly clock: Clock = () => new Date(),
    private readonly linkExpirySeconds = 60,
  ) {
    if (
      linkExpirySeconds < 1 ||
      linkExpirySeconds > 300 ||
      !Number.isInteger(linkExpirySeconds)
    ) {
      throw new SponsorStatusError("SUPERSERVE_LINK_EXPIRY_INVALID");
    }

    for (const binding of bindings) {
      assertPreviewPort(binding.preview_port);
      if (binding.viewer_port !== undefined) {
        assertPreviewPort(binding.viewer_port);
      }
    }
  }

  async readViews(_jobId: string): Promise<readonly SuperserveViewRecord[]> {
    return Promise.all(this.bindings.map((binding) => this.readView(binding)));
  }

  private async readView(
    binding: SuperserveSandboxViewBinding,
  ): Promise<SuperserveViewRecord> {
    // connect() refreshes the data-plane token. Never expose that token.
    const sandbox = await this.sdk.connect(binding.sandbox_id);
    // getInfo() is required because sandbox.status is only a stale snapshot.
    const info = await sandbox.getInfo();

    if (info.id !== binding.sandbox_id) {
      throw new SponsorStatusError("SUPERSERVE_SANDBOX_ID_MISMATCH");
    }

    const observed = this.clock();
    const last_activity_at = observed.toISOString();
    const status = mapSuperserveLifecycleStatus(
      info.status,
      binding.active_status,
    );

    if (info.status !== "active") {
      return {
        variant: binding.variant,
        sandbox_id: binding.sandbox_id,
        status,
        task: binding.task,
        latest_frame: binding.latest_frame,
        last_activity_at,
      };
    }

    const expires_at = new Date(
      observed.getTime() + this.linkExpirySeconds * 1_000,
    ).toISOString();

    // Publishing with an explicit private policy is idempotent and prevents a
    // previously public port from leaking an unsigned preview.
    await sandbox.publishPreviewPort(binding.preview_port, { access: "private" });
    const preview: ExpiringLink = {
      url: await sandbox.getSignedPreviewUrl(binding.preview_port, {
        expiresInSeconds: this.linkExpirySeconds,
      }),
      expires_at,
    };

    let viewer: ExpiringLink | undefined;
    if (binding.viewer_port !== undefined) {
      await sandbox.publishPreviewPort(binding.viewer_port, { access: "private" });
      viewer = {
        url: await sandbox.getSignedPreviewUrl(binding.viewer_port, {
          expiresInSeconds: this.linkExpirySeconds,
        }),
        expires_at,
      };
    }

    return {
      variant: binding.variant,
      sandbox_id: binding.sandbox_id,
      status,
      task: binding.task,
      viewer,
      preview,
      latest_frame: binding.latest_frame,
      last_activity_at,
    };
  }
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
