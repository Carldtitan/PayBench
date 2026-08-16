import "../integrations/server-only";

import { createDecipheriv, createHash } from "node:crypto";
import { SupabaseControlTransport, resolveSupabaseServerKey } from "../control/supabase-repository";

function decrypt(secret: string, value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("RUN_TOKEN_INVALID");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export interface PublicRunStatus {
  job_id: string;
  website_url: string;
  target_customer: string;
  state: "working" | "participant_ready" | "complete" | "failed";
  source_captured: boolean;
  variants_built: boolean;
  qa_passed: boolean;
  participant_url?: string;
  report_url?: string;
}

export async function getPublicRunStatus(jobId: string): Promise<PublicRunStatus> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("RUN_NOT_FOUND");
  }
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.APP_SIGNING_SECRET;
  if (!baseUrl || !secret) throw new Error("RUN_STORAGE_MISSING");
  const serverKey = await resolveSupabaseServerKey(process.env);
  const transport = new SupabaseControlTransport(baseUrl, serverKey);
  const [job] = await transport.request("GET", "jobs", {
    select: "id,submitted_url,normalized_url,target_customer_description,status",
    id: `eq.${jobId}`,
    limit: "1",
  });
  if (!job) throw new Error("RUN_NOT_FOUND");
  const [captures, variants, gates, studies, reports] = await Promise.all([
    transport.request("GET", "website_captures", { select: "id", job_id: `eq.${jobId}`, limit: "1" }),
    transport.request("GET", "variants", { select: "id,label", job_id: `eq.${jobId}` }),
    transport.request("GET", "quality_gate_runs", { select: "gate_open", job_id: `eq.${jobId}`, order: "checked_at.desc", limit: "1" }),
    transport.request("GET", "studies", { select: "phase,opaque_token_ciphertext", job_id: `eq.${jobId}`, limit: "1" }),
    transport.request("GET", "reports", { select: "public_token_ciphertext", job_id: `eq.${jobId}`, limit: "1" }),
  ]);
  const study = studies[0];
  const report = reports[0];
  const participantToken = typeof study?.opaque_token_ciphertext === "string"
    ? decrypt(secret, study.opaque_token_ciphertext)
    : undefined;
  const reportToken = typeof report?.public_token_ciphertext === "string"
    ? decrypt(secret, report.public_token_ciphertext)
    : undefined;
  const status = String(job.status);
  const participantReady = Boolean(participantToken) && ["pilot", "main", "complete"].includes(String(study?.phase));
  return {
    job_id: jobId,
    website_url: String(job.normalized_url ?? job.submitted_url),
    target_customer: String(job.target_customer_description ?? ""),
    state: reportToken ? "complete" : participantReady ? "participant_ready" : status === "failed" ? "failed" : "working",
    source_captured: captures.length > 0,
    variants_built: variants.some((row) => row.label === "A") && variants.some((row) => row.label === "B"),
    qa_passed: Boolean(gates[0]?.gate_open),
    ...(participantToken ? { participant_url: `/s/${encodeURIComponent(participantToken)}` } : {}),
    ...(reportToken ? { report_url: `/report/${encodeURIComponent(reportToken)}` } : {}),
  };
}
