import "./server-only";

import type { PaywallSpec, SandboxLiveState } from "@paybench/contracts";
import { validatePaywallSpec } from "../../../../../packages/paywall/src";
import { createCaptureEvidencePlan } from "./capture";
import type { CapturedPageEvidence } from "./anthropic";

const WORKDIR = "/workspace/paybench";
const PREVIEW_PORT = 4173;
const PREVIEW_EXPIRY_SECONDS = 60;

const SANDBOX_SERVER_SOURCE = `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const render = (node) => {
  const p = node.props || {};
  const children = (node.children || []).map(render).join("");
  switch (node.type) {
    case "PaywallShell": return '<main class="paywall">' + children + '</main>';
    case "BrandHeader": return '<header><strong>' + escapeHtml(p.name) + '</strong></header>';
    case "OfferSummary": return '<section><small>' + escapeHtml(p.product_name) + '</small><h1>' + escapeHtml(p.headline) + '</h1><strong>' + escapeHtml(p.price_display) + '</strong>' + strings(p.billing_terms).map((x) => '<p>' + escapeHtml(x) + '</p>').join("") + '</section>';
    case "PlanSelector": return '<fieldset><legend>Choose a plan</legend>' + (Array.isArray(p.plans) ? p.plans : []).map((plan) => '<label><input type="radio" disabled> ' + escapeHtml(plan.name) + ' — ' + escapeHtml(plan.price_display) + '</label>').join("") + '</fieldset>';
    case "BenefitList": return '<ul>' + strings(p.items).map((x) => '<li>' + escapeHtml(x) + '</li>').join("") + '</ul>';
    case "TrustPanel": return '<aside>' + strings(p.items).map((x) => '<p>' + escapeHtml(x) + '</p>').join("") + '</aside>';
    case "CheckoutForm": return '<section><h2>Simulated checkout</h2><p>' + escapeHtml(p.fake_customer_name) + '</p><p>' + escapeHtml(p.fake_billing_address) + '</p><p>' + escapeHtml(p.fake_payment_token) + '</p></section>';
    case "OrderSummary": return '<section><h2>' + escapeHtml(p.title || "Review") + '</h2></section>';
    case "PrimaryAction": return '<button disabled>' + escapeHtml(p.label) + '</button>';
    case "LegalFooter": return '<footer>' + strings(p.items).map((x) => '<small>' + escapeHtml(x) + '</small>').join("") + '</footer>';
    case "SimulationNotice": return '<aside><strong>Simulation</strong><p>' + escapeHtml(p.message) + '</p><p>' + escapeHtml(p.simulated_budget) + '</p></aside>';
    default: throw new Error("UNSUPPORTED_COMPONENT");
  }
};
const spec = JSON.parse(await readFile("${WORKDIR}/variant.json", "utf8"));
const page = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PayBench operator preview</title><style>body{margin:0;padding:32px;background:#eef4f6;color:#12313d;font:15px system-ui}.paywall{max-width:780px;margin:auto;padding:28px;border-radius:14px;background:white}section,aside,fieldset,footer{margin-top:18px}label,small{display:block;margin-top:8px}button{margin-top:18px;padding:12px 18px}</style></head><body>' + render(spec.tree) + '</body></html>';
createServer((_request, response) => { response.writeHead(200, {"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-frame-options":"SAMEORIGIN"}); response.end(page); }).listen(${PREVIEW_PORT}, "0.0.0.0");
`;

export interface SuperserveCommandSession {
  kill(signal?: string): Promise<void>;
}

export interface SuperserveSandboxInstance {
  readonly id: string;
  files: {
    write(path: string, content: string): Promise<void>;
    readText?(path: string): Promise<string>;
  };
  commands: {
    spawn(command: string, options?: { cwd?: string }): Promise<SuperserveCommandSession>;
    run(command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  getInfo(): Promise<{ id: string; status: "active" | "paused" | "resuming" | "failed" }>;
  publishPreviewPort(port: number, options: { access: "private" }): Promise<unknown>;
  getSignedPreviewUrl(port: number, options: { expiresInSeconds: number }): Promise<string>;
  pause(): Promise<void>;
  kill(): Promise<void>;
}

const CAPTURE_SCRIPT = String.raw`
import hashlib, html, json, os, re, shutil, subprocess, sys
from html.parser import HTMLParser

class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        value = " ".join(data.split())
        if value:
            self.parts.append(value)

source = open("/workspace/paybench/source-url.txt", "r", encoding="utf-8").read().strip()
browser = next((shutil.which(name) for name in ["google-chrome", "chromium", "chromium-browser"] if shutil.which(name)), None)
if not browser:
    print("SUPERSERVE_BROWSER_UNAVAILABLE", file=sys.stderr)
    sys.exit(17)

common = [browser, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars"]
desktop = "/workspace/paybench/desktop.png"
mobile = "/workspace/paybench/mobile.png"
subprocess.run(common + ["--window-size=1440,960", "--screenshot=" + desktop, source], check=True, timeout=30)
subprocess.run(common + ["--window-size=390,844", "--screenshot=" + mobile, source], check=True, timeout=30)
dom = subprocess.run(common + ["--dump-dom", source], check=True, capture_output=True, text=True, timeout=30).stdout
parser = Text()
parser.feed(dom)
visible = "\n".join(parser.parts)
colors = list(dict.fromkeys(re.findall(r"#[0-9a-fA-F]{6}", dom)))[:24]
title_match = re.search(r"<title[^>]*>(.*?)</title>", dom, re.I | re.S)
result = {
  "source_url": source,
  "source_hash": hashlib.sha256(dom.encode("utf-8")).hexdigest(),
  "desktop_screenshot_path": desktop,
  "mobile_screenshot_path": mobile,
  "reduced_dom": dom[:200000],
  "visible_text": visible[:100000],
  "brand_tokens": {"title": html.unescape(title_match.group(1).strip()) if title_match else "", "colors": colors},
}
open("/workspace/paybench/capture.json", "w", encoding="utf-8").write(json.dumps(result))
`;

export interface SuperserveSandboxFactory {
  create(options: {
    name: string;
    timeoutSeconds: number;
    autoDeleteSeconds: number;
    previewAccess: "private";
    metadata: Record<string, string>;
    network: { allowOut: string[]; denyOut: string[] };
  }): Promise<SuperserveSandboxInstance>;
}

export const defaultSuperserveSandboxFactory: SuperserveSandboxFactory = {
  async create(options) {
    const { Sandbox } = await import("@superserve/sdk");
    return Sandbox.create(options) as unknown as SuperserveSandboxInstance;
  },
};

export interface SuperserveCapturedEvidence extends CapturedPageEvidence {
  sandbox_id: string;
}

export class SuperserveCaptureAdapter {
  constructor(
    private readonly factory: SuperserveSandboxFactory = defaultSuperserveSandboxFactory,
  ) {}

  async capture(jobId: string, sourceUrl: string): Promise<SuperserveCapturedEvidence> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new Error("JOB_ID_INVALID");
    }
    const plan = await createCaptureEvidencePlan(sourceUrl);
    const hostname = new URL(plan.sourceUrl).hostname;
    const sandbox = await this.factory.create({
      name: `paybench-${jobId.slice(0, 8)}-capture`,
      timeoutSeconds: 1_800,
      autoDeleteSeconds: 86_400,
      previewAccess: "private",
      metadata: {
        app: "paybench",
        job_id: jobId,
        purpose: "source-capture",
        visibility: "operator-only",
      },
      network: {
        allowOut: [hostname, `*.${hostname}`, "superserve.ai", "*.superserve.ai"],
        denyOut: ["0.0.0.0/0"],
      },
    });
    try {
      await sandbox.files.write(`${WORKDIR}/source-url.txt`, plan.sourceUrl);
      await sandbox.files.write(`${WORKDIR}/capture.py`, CAPTURE_SCRIPT);
      const result = await sandbox.commands.run(`python3 ${WORKDIR}/capture.py`, {
        cwd: WORKDIR,
        timeoutMs: 90_000,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.includes("SUPERSERVE_BROWSER_UNAVAILABLE")
          ? "SUPERSERVE_BROWSER_UNAVAILABLE"
          : "SUPERSERVE_CAPTURE_FAILED");
      }
      if (!sandbox.files.readText) throw new Error("SUPERSERVE_FILE_READ_UNAVAILABLE");
      const evidence = JSON.parse(await sandbox.files.readText(`${WORKDIR}/capture.json`)) as CapturedPageEvidence;
      if (!/^[a-f0-9]{64}$/.test(evidence.source_hash)) throw new Error("SUPERSERVE_CAPTURE_INVALID");
      await sandbox.pause();
      return { ...evidence, sandbox_id: sandbox.id };
    } catch (error) {
      await sandbox.kill();
      throw error;
    }
  }
}

export interface OpenWorkSurfacesRequest {
  jobId: string;
  operatorAuthorized: true;
  sourceUrl: string;
  control: PaywallSpec;
  challenger: PaywallSpec;
}

export interface OperatorSandboxSurface extends SandboxLiveState {
  operator_only: true;
}

export class SuperserveWorkSurfaceAdapter {
  constructor(
    private readonly factory: SuperserveSandboxFactory = defaultSuperserveSandboxFactory,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async open(request: OpenWorkSurfacesRequest): Promise<readonly [OperatorSandboxSurface, OperatorSandboxSurface]> {
    if (request.operatorAuthorized !== true) throw new Error("OPERATOR_ACCESS_REQUIRED");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.jobId)) throw new Error("JOB_ID_INVALID");
    const source = new URL(request.sourceUrl);
    if (!/^https?:$/.test(source.protocol)) throw new Error("SOURCE_URL_INVALID");
    const variants = [
      { label: "A" as const, task: "Reproduce captured paywall", spec: validatePaywallSpec(request.control) },
      { label: "B" as const, task: "Apply one controlled change", spec: validatePaywallSpec(request.challenger) },
    ];
    const created: SuperserveSandboxInstance[] = [];

    try {
      const surfaces: OperatorSandboxSurface[] = [];
      for (const variant of variants) {
        const sandbox = await this.factory.create({
          name: `paybench-${request.jobId.slice(0, 8)}-${variant.label.toLowerCase()}`,
          timeoutSeconds: 1_800,
          autoDeleteSeconds: 86_400,
          previewAccess: "private",
          metadata: { app: "paybench", job_id: request.jobId, variant: variant.label, visibility: "operator-only" },
          network: {
            allowOut: [source.hostname, `*.${source.hostname}`, "superserve.ai", "*.superserve.ai"],
            denyOut: ["0.0.0.0/0"],
          },
        });
        created.push(sandbox);
        await sandbox.files.write(`${WORKDIR}/variant.json`, JSON.stringify(variant.spec));
        await sandbox.files.write(`${WORKDIR}/server.mjs`, SANDBOX_SERVER_SOURCE);
        await sandbox.commands.spawn(`node ${WORKDIR}/server.mjs`, { cwd: WORKDIR });
        const readiness = await sandbox.commands.run(
          `node -e "fetch('http://127.0.0.1:${PREVIEW_PORT}').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"`,
          { cwd: WORKDIR, timeoutMs: 10_000 },
        );
        if (readiness.exitCode !== 0) throw new Error("SUPERSERVE_PREVIEW_NOT_READY");
        const info = await sandbox.getInfo();
        if (info.id !== sandbox.id || info.status !== "active") throw new Error("SUPERSERVE_SANDBOX_NOT_ACTIVE");
        await sandbox.publishPreviewPort(PREVIEW_PORT, { access: "private" });
        const preview = new URL(await sandbox.getSignedPreviewUrl(PREVIEW_PORT, { expiresInSeconds: PREVIEW_EXPIRY_SECONDS }));
        if (preview.protocol !== "https:") throw new Error("SUPERSERVE_PREVIEW_NOT_HTTPS");
        surfaces.push({
          variant: variant.label,
          sandbox_id: sandbox.id,
          status: "ready",
          task: variant.task,
          preview_url: preview.toString(),
          last_activity_at: this.clock().toISOString(),
          operator_only: true,
        });
      }
      return surfaces as unknown as readonly [OperatorSandboxSurface, OperatorSandboxSurface];
    } catch (error) {
      await Promise.allSettled(created.map((sandbox) => sandbox.kill()));
      throw error;
    }
  }
}
