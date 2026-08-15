import "../integrations/server-only";

import { createHmac } from "node:crypto";
import { directionalReportSchema, type DirectionalReport } from "@paybench/contracts";
import {
  SupabaseControlTransport,
  resolveSupabaseServerKey,
} from "../control/supabase-repository";
import { StudyError } from "./repository";

export interface FounderReportView {
  website_url: string;
  report: DirectionalReport;
  created_at: string;
}

export async function getFounderReport(token: string): Promise<FounderReportView> {
  if (!/^pbr_[A-Za-z0-9_-]{24,80}$/.test(token)) {
    throw new StudyError("REPORT_NOT_FOUND", 404);
  }
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.APP_SIGNING_SECRET;
  if (!baseUrl || !secret) throw new StudyError("REPORT_STORAGE_NOT_CONFIGURED", 503);
  const serverKey = await resolveSupabaseServerKey(process.env);
  const transport = new SupabaseControlTransport(baseUrl, serverKey);
  const tokenHash = createHmac("sha256", secret).update(`report:${token}`).digest("hex");
  const [report] = await transport.request("GET", "reports", {
    select: "job_id,metrics_json,created_at,expires_at",
    public_token_hash: `eq.${tokenHash}`,
    limit: "1",
  });
  if (!report || new Date(String(report.expires_at)).getTime() <= Date.now()) {
    throw new StudyError("REPORT_NOT_FOUND", 404);
  }
  const [job] = await transport.request("GET", "jobs", {
    select: "submitted_url,normalized_url",
    id: `eq.${String(report.job_id)}`,
    limit: "1",
  });
  if (!job) throw new StudyError("REPORT_NOT_FOUND", 404);
  return {
    website_url: String(job.normalized_url ?? job.submitted_url),
    report: directionalReportSchema.parse(report.metrics_json),
    created_at: String(report.created_at),
  };
}
