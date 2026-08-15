import type {
  DashboardRunEvent,
  DashboardRunListItem,
  DashboardRunSnapshot,
} from "@paybench/contracts";
import { DEMO_CANONICAL_RUNS } from "./fixtures";
import {
  deriveDashboardRunEvents,
  deriveDashboardRunSnapshot,
  type DashboardRepository,
} from "./repository";

export class DemoDashboardRepository implements DashboardRepository {
  private readonly snapshots = DEMO_CANONICAL_RUNS.map((records) =>
    deriveDashboardRunSnapshot(records),
  );

  async listRuns(): Promise<DashboardRunListItem[]> {
    return this.snapshots
      .map(
        ({
          job_id,
          founder_label,
          website_url,
          job_status,
          source,
          paid,
          current_stage,
          updated_at,
        }) => ({
          job_id,
          founder_label,
          website_url,
          job_status,
          source,
          paid,
          current_stage,
          updated_at,
        }),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getRun(jobId: string): Promise<DashboardRunSnapshot | null> {
    return this.snapshots.find((snapshot) => snapshot.job_id === jobId) ?? null;
  }

  async listEvents(jobId: string): Promise<DashboardRunEvent[] | null> {
    const records = DEMO_CANONICAL_RUNS.find((run) => run.job.id === jobId);
    return records ? deriveDashboardRunEvents(records) : null;
  }
}

let repository: DashboardRepository | undefined;

export function getDashboardRepository(): DashboardRepository {
  repository ??= new DemoDashboardRepository();
  return repository;
}

