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
import {
  SupabaseDashboardRepository,
  SupabaseRestTransport,
  type DashboardTableTransport,
} from "./supabase-repository";

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

export interface DashboardRepositoryEnvironment {
  DASHBOARD_DATA_SOURCE?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export function createDashboardRepository(
  environment: DashboardRepositoryEnvironment = process.env as DashboardRepositoryEnvironment,
  transport?: DashboardTableTransport,
): DashboardRepository {
  if (environment.DASHBOARD_DATA_SOURCE?.toLowerCase() === "demo") {
    return new DemoDashboardRepository();
  }

  if (
    environment.NEXT_PUBLIC_SUPABASE_URL &&
    environment.SUPABASE_SECRET_KEY
  ) {
    return new SupabaseDashboardRepository(
      transport ??
        new SupabaseRestTransport(
          environment.NEXT_PUBLIC_SUPABASE_URL,
          environment.SUPABASE_SECRET_KEY,
        ),
    );
  }

  // The returned snapshots remain visibly marked Demo. This fallback keeps a
  // new local checkout usable without pretending that sponsor systems are live.
  return new DemoDashboardRepository();
}

export function getDashboardRepository(): DashboardRepository {
  repository ??= createDashboardRepository();
  return repository;
}
