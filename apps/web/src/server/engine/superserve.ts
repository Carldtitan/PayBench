import "./server-only";

import type { PaywallSpec, SandboxLiveState } from "@paybench/contracts";
import { validatePaywallSpec } from "../../../../../packages/paywall/src";
import { createCaptureEvidencePlan, type CaptureEvidencePlan } from "./capture";
import type { CapturedPageEvidence } from "./anthropic";

const WORKDIR = "/workspace/paybench";
const PREVIEW_PORT = 4173;
const PREVIEW_EXPIRY_SECONDS = 3_600;
const PREVIEW_READY_ATTEMPTS = 40;
const PREVIEW_READY_DELAY_MS = 250;

export const SANDBOX_CLIENT_SOURCE = `
const byId = (id) => document.getElementById(id);
const checkout = byId("fake-checkout");
const review = byId("order-review");
const survey = byId("participant-survey");
const status = byId("journey-status");
const stop = byId("stop-action");
const continueAction = byId("continue-action");
let decision = null;

const announce = (message) => {
  status.textContent = message;
  status.hidden = false;
};

const selectedPlan = () => document.querySelector('input[name="plan"]:checked');

for (const id of ["fake-name", "fake-postal", "fake-token"]) {
  byId(id).addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
}

continueAction.addEventListener("click", () => {
  if (!selectedPlan()) {
    announce("Choose a plan first.");
    return;
  }
  checkout.hidden = false;
  continueAction.hidden = true;
  announce("Use only the supplied simulated details. No payment information is accepted.");
  byId("fake-name").focus();
});

checkout.addEventListener("submit", (event) => {
  event.preventDefault();
  const expected = {
    "fake-name": "Alex Example",
    "fake-postal": "00000",
    "fake-token": "SIMULATED-TOKEN",
  };
  let valid = true;
  for (const [id, value] of Object.entries(expected)) {
    const input = byId(id);
    const matches = input.value.trim() === value;
    input.setCustomValidity(matches ? "" : "Use the supplied simulated value: " + value);
    valid = matches && valid;
  }
  if (!valid || !checkout.reportValidity()) {
    announce("Use the supplied simulated values to continue.");
    return;
  }
  const plan = selectedPlan();
  byId("review-plan").textContent = plan.dataset.name;
  byId("review-price").textContent = plan.dataset.price;
  byId("review-name").textContent = byId("fake-name").value;
  checkout.hidden = true;
  review.hidden = false;
  announce("Review the simulated order. Nothing will be charged.");
});

byId("edit-simulation").addEventListener("click", () => {
  review.hidden = true;
  checkout.hidden = false;
  announce("Edit the supplied simulated details.");
});

const askForSurvey = (nextDecision) => {
  decision = nextDecision;
  checkout.hidden = true;
  review.hidden = true;
  continueAction.hidden = true;
  stop.hidden = true;
  survey.hidden = false;
  byId("decision-label").textContent = nextDecision === "continue" ? "You continued" : "You stopped";
  announce("Tell us why. Continuing and stopping are equally valid.");
  byId("clarity").focus();
};

byId("simulate-purchase").addEventListener("click", () => askForSurvey("continue"));
stop.addEventListener("click", () => askForSurvey("stop"));

survey.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!survey.reportValidity()) return;
  const explanation = byId("explanation").value.trim();
  if (explanation.length < 5) {
    byId("explanation").setCustomValidity("Please give a short reason.");
    byId("explanation").reportValidity();
    return;
  }
  byId("explanation").setCustomValidity("");
  survey.hidden = true;
  byId("completion").hidden = false;
  byId("completion-decision").textContent = decision === "continue" ? "continued" : "stopped";
  announce("Journey complete. The result is simulated and no account was created.");
});
`;

export const SANDBOX_SERVER_SOURCE = `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const render = (node) => {
  const p = node.props || {};
  const children = (node.children || []).map(render).join("");
  switch (node.type) {
    case "PaywallShell": return '<div class="paywall-content">' + children + '</div>';
    case "BrandHeader": return '<header><strong>' + escapeHtml(p.name) + '</strong></header>';
    case "OfferSummary": return '<section><small>' + escapeHtml(p.product_name) + '</small><h1>' + escapeHtml(p.headline) + '</h1><strong>' + escapeHtml(p.price_display) + '</strong>' + strings(p.billing_terms).map((x) => '<p>' + escapeHtml(x) + '</p>').join("") + '</section>';
    case "PlanSelector": return '<fieldset id="plan-step" data-testid="plan-selector"><legend>Choose a plan</legend>' + (Array.isArray(p.plans) ? p.plans : []).map((plan, index) => '<label><input type="radio" name="plan" value="' + escapeHtml(plan.id) + '" data-name="' + escapeHtml(plan.name) + '" data-price="' + escapeHtml(plan.price_display) + '" ' + (index === 0 ? 'checked' : '') + '> <span>' + escapeHtml(plan.name) + '</span><strong>' + escapeHtml(plan.price_display) + '</strong></label>').join("") + '</fieldset>';
    case "BenefitList": return '<ul>' + strings(p.items).map((x) => '<li>' + escapeHtml(x) + '</li>').join("") + '</ul>';
    case "TrustPanel": return '<aside>' + strings(p.items).map((x) => '<p>' + escapeHtml(x) + '</p>').join("") + '</aside>';
    case "CheckoutForm": return '<form id="fake-checkout" data-testid="fake-checkout" hidden><h2>Simulated checkout</h2><p class="notice">Use these exact sample values. Never enter real payment information.</p><label>Name<input id="fake-name" name="fake-name" value="Alex Example" autocomplete="off" required></label><label>Postal code<input id="fake-postal" name="fake-postal" value="00000" inputmode="numeric" autocomplete="off" required></label><label>Simulation token<input id="fake-token" name="fake-token" value="SIMULATED-TOKEN" autocomplete="off" required></label><button type="submit" data-testid="review-order">Review order</button></form>';
    case "OrderSummary": return '<section id="order-review" data-testid="order-review" hidden><h2>' + escapeHtml(p.title || "Review") + '</h2><dl><dt>Plan</dt><dd id="review-plan"></dd><dt>Price</dt><dd id="review-price"></dd><dt>Simulated customer</dt><dd id="review-name"></dd></dl><div class="button-row"><button id="edit-simulation" type="button" class="secondary">Edit</button><button id="simulate-purchase" type="button" data-testid="simulate-purchase">Complete simulated purchase</button></div></section>';
    case "PrimaryAction": return '<button id="continue-action" type="button" data-testid="continue-action">' + escapeHtml(p.label) + '</button>';
    case "LegalFooter": return '<footer>' + strings(p.items).map((x) => '<small>' + escapeHtml(x) + '</small>').join("") + '</footer>';
    case "SimulationNotice": return '<aside><strong>Simulation</strong><p>' + escapeHtml(p.message) + '</p><p>' + escapeHtml(p.simulated_budget) + '</p></aside>';
    default: throw new Error("UNSUPPORTED_COMPONENT");
  }
};
const spec = JSON.parse(await readFile("${WORKDIR}/variant.json", "utf8"));
const clientSource = ${JSON.stringify(SANDBOX_CLIENT_SOURCE)};
const journey = '<p id="journey-status" class="status" role="status" hidden></p><button id="stop-action" class="stop" type="button" data-testid="stop-action">I would stop here</button><form id="participant-survey" data-testid="participant-survey" hidden><p id="decision-label" class="eyebrow"></p><h2>What shaped your decision?</h2><label>How clear was this page?<select id="clarity" name="clarity" required><option value="">Choose</option><option value="1">1 · Not clear</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · Very clear</option></select></label><label>Why?<textarea id="explanation" name="explanation" minlength="5" required></textarea></label><button type="submit" data-testid="submit-survey">Submit response</button></form><section id="completion" data-testid="completion" hidden><p class="eyebrow">Response recorded</p><h2>Journey complete</h2><p>You <strong id="completion-decision"></strong>. No payment was made and no account was created.</p><a href="/mock-completion" data-testid="mock-completion-redirect">Test mock completion redirect</a></section>';
const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PayBench operator preview</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:32px;background:#eef4f6;color:#12313d;font:15px system-ui,sans-serif}.paywall{max-width:780px;margin:auto;padding:28px;border:1px solid #c7d7dd;border-radius:18px;background:white;box-shadow:0 18px 55px rgba(18,49,61,.12)}header{display:flex;justify-content:space-between;font-size:18px}section,aside,fieldset,footer,form{margin-top:20px}fieldset{border:0;padding:0;display:grid;gap:10px}fieldset label{display:flex;align-items:center;gap:10px;padding:14px;border:1px solid #c7d7dd;border-radius:12px}fieldset label strong{margin-left:auto}label,small{display:block;margin-top:10px}input,select,textarea{display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #9eb3bc;border-radius:9px;font:inherit}input[type=radio]{width:auto;margin:0;padding:0;flex:0 0 auto}textarea{min-height:92px;resize:vertical}button{margin-top:18px;padding:12px 18px;border:0;border-radius:9px;background:#006681;color:white;font:inherit;font-weight:700;cursor:pointer}button.secondary,.stop{background:white;color:#006681;border:1px solid #79a1b0}.stop{display:block;margin:18px auto 0}.button-row{display:flex;gap:10px;flex-wrap:wrap}.notice,.status{padding:10px 12px;border-radius:9px;background:#edf7fa}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#006681}dl{display:grid;grid-template-columns:1fr auto;gap:8px}dd{font-weight:700}@media(max-width:600px){body{padding:14px}.paywall{padding:20px}}</style><script src="/app.js" defer></script></head><body><main class="paywall" data-testid="paywall-preview">' + render(spec.tree) + journey + '</main></body></html>';
const port = Number(process.env.PAYBENCH_PREVIEW_PORT || "${PREVIEW_PORT}");
createServer((request, response) => {
  const headers = {"cache-control":"private, no-store","content-security-policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'none'; img-src 'self' data:; frame-ancestors https://paybench.vercel.app https://*.vercel.app","x-content-type-options":"nosniff"};
  if (request.url === "/healthz") { response.writeHead(200, {...headers,"content-type":"text/plain; charset=utf-8"}); response.end("ready"); return; }
  if (request.url === "/app.js") { response.writeHead(200, {...headers,"content-type":"text/javascript; charset=utf-8"}); response.end(clientSource); return; }
  if (request.url === "/mock-completion") { response.writeHead(200, {...headers,"content-type":"text/html; charset=utf-8"}); response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock completion received</title></head><body><main data-testid="mock-completion-received"><h1>Mock completion received</h1><p>No Terac request was made.</p></main></body></html>'); return; }
  response.writeHead(200, {...headers,"content-type":"text/html; charset=utf-8"}); response.end(page);
}).listen(port, "0.0.0.0");
`;

export interface SuperserveCommandSession {
  kill(signal?: string): Promise<void>;
}

export interface SuperservePublishedPreviewPort {
  port: number;
  access: "private";
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
  publishPreviewPort(port: number, options: { access: "private" }): Promise<SuperservePublishedPreviewPort>;
  getSignedPreviewUrl(port: number, options: { expiresInSeconds: number }): Promise<string>;
  pause(): Promise<void>;
  kill(): Promise<void>;
}

export const CAPTURE_SCRIPT = String.raw`
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";

const blockedHost = (hostname) => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (family === 6) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb") || host.startsWith("::ffff:");
  }
  return false;
};

const fail = (code) => {
  console.error("PAYBENCH_CAPTURE_ERROR:" + code);
  process.exitCode = 1;
};

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("SUPERSERVE_PLAYWRIGHT_UNAVAILABLE");
}

if (chromium) {
  const source = (await readFile("/workspace/paybench/source-url.txt", "utf8")).trim();
  const desktop = "/workspace/paybench/desktop.png";
  const mobile = "/workspace/paybench/mobile.png";
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    fail("SUPERSERVE_BROWSER_UNAVAILABLE");
  }

  if (browser) {
    let phase = "DESKTOP";
    try {
      const capture = async (viewport, screenshotPath, collectEvidence) => {
        const context = await browser.newContext({
          viewport,
          acceptDownloads: false,
          ignoreHTTPSErrors: true,
          serviceWorkers: "block",
        });
        await context.clearPermissions();
        const page = await context.newPage();
        page.on("dialog", (dialog) => void dialog.dismiss());
        page.on("popup", (popup) => void popup.close());
        await page.route("**/*", async (route) => {
          const target = new URL(route.request().url());
          if ((target.protocol !== "http:" && target.protocol !== "https:") || blockedHost(target.hostname)) return route.abort("blockedbyclient");
          return route.continue();
        });
        const response = await page.goto(source, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!response) throw new Error("navigation produced no response");
        const contentLength = Number(response.headers()["content-length"] || "0");
        if (contentLength > 20 * 1024 * 1024) throw new Error("response exceeded capture limit");
        await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
        if (!collectEvidence) {
          await context.close();
          return null;
        }
        const evidence = await page.evaluate(() => {
          const body = document.body;
          const styles = body ? getComputedStyle(body) : null;
          const colors = new Set();
          for (const element of Array.from(document.querySelectorAll("body *")).slice(0, 500)) {
            const style = getComputedStyle(element);
            for (const value of [style.color, style.backgroundColor, style.borderColor]) {
              if (value && value !== "rgba(0, 0, 0, 0)") colors.add(value);
            }
          }
          return {
            dom: document.documentElement.outerHTML,
            visibleText: body?.innerText || "",
            brandTokens: {
              title: document.title,
              colors: Array.from(colors).slice(0, 24),
              font_family: styles?.fontFamily || "",
            },
          };
        });
        await context.close();
        return evidence;
      };

      const evidence = await capture({ width: 1440, height: 960 }, desktop, true);
      phase = "MOBILE";
      await capture({ width: 390, height: 844 }, mobile, false);
      if (!evidence) throw new Error("capture evidence missing");
      phase = "WRITE";
      const dom = evidence.dom.slice(0, 200_000);
      await writeFile("/workspace/paybench/capture.json", JSON.stringify({
        source_url: source,
        source_hash: createHash("sha256").update(evidence.dom).digest("hex"),
        desktop_screenshot_path: desktop,
        mobile_screenshot_path: mobile,
        reduced_dom: dom,
        visible_text: evidence.visibleText.slice(0, 100_000),
        brand_tokens: evidence.brandTokens,
      }), "utf8");
    } catch {
      fail("SUPERSERVE_CAPTURE_" + phase + "_FAILED");
    } finally {
      await browser.close();
    }
  }
}
`;

export interface SuperserveSandboxFactory {
  create(options: {
    name: string;
    fromTemplate?: string;
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

export interface SuperserveCaptureOptions {
  template: string;
}

export type CapturePlanBuilder = (sourceUrl: string) => Promise<CaptureEvidencePlan>;

const CAPTURE_ERROR_CODES = new Set([
  "SUPERSERVE_PLAYWRIGHT_UNAVAILABLE",
  "SUPERSERVE_BROWSER_UNAVAILABLE",
  "SUPERSERVE_CAPTURE_RUNTIME_FAILED",
  "SUPERSERVE_CAPTURE_DESKTOP_FAILED",
  "SUPERSERVE_CAPTURE_MOBILE_FAILED",
  "SUPERSERVE_CAPTURE_WRITE_FAILED",
]);

function captureCommandError(stderr: string): string {
  const candidate = /PAYBENCH_CAPTURE_ERROR:(SUPERSERVE_[A-Z_]+)/.exec(stderr)?.[1];
  return candidate && CAPTURE_ERROR_CODES.has(candidate)
    ? candidate
    : "SUPERSERVE_CAPTURE_FAILED";
}

export class SuperserveCaptureAdapter {
  constructor(
    private readonly factory: SuperserveSandboxFactory = defaultSuperserveSandboxFactory,
    private readonly options: SuperserveCaptureOptions = {
      template: process.env.SUPERSERVE_TEMPLATE ?? "",
    },
    private readonly buildPlan: CapturePlanBuilder = createCaptureEvidencePlan,
  ) {}

  async capture(jobId: string, sourceUrl: string): Promise<SuperserveCapturedEvidence> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new Error("JOB_ID_INVALID");
    }
    const template = this.options.template.trim();
    if (!template) throw new Error("SUPERSERVE_TEMPLATE_REQUIRED");
    const plan = await this.buildPlan(sourceUrl);
    const sandbox = await this.factory.create({
      name: `paybench-${jobId.slice(0, 8)}-capture`,
      fromTemplate: template,
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
        // The sandbox contains no sponsor credentials. Browser interception
        // above blocks private/link-local destinations while allowing the
        // public page's CDN assets to load accurately.
        allowOut: ["0.0.0.0/0"],
        denyOut: [],
      },
    });
    try {
      await sandbox.files.write(`${WORKDIR}/source-url.txt`, plan.sourceUrl);
      await sandbox.files.write(`${WORKDIR}/capture.mjs`, CAPTURE_SCRIPT);
      const result = await sandbox.commands.run(`node ${WORKDIR}/capture.mjs`, {
        cwd: WORKDIR,
        timeoutMs: 90_000,
      });
      if (result.exitCode !== 0) {
        throw new Error(captureCommandError(result.stderr));
      }
      const artifacts = await sandbox.commands.run(
        `test -s ${WORKDIR}/desktop.png && test -s ${WORKDIR}/mobile.png && test -s ${WORKDIR}/capture.json`,
        { cwd: WORKDIR, timeoutMs: 10_000 },
      );
      if (artifacts.exitCode !== 0) throw new Error("SUPERSERVE_CAPTURE_ARTIFACTS_MISSING");
      if (!sandbox.files.readText) throw new Error("SUPERSERVE_FILE_READ_UNAVAILABLE");
      const evidence = JSON.parse(await sandbox.files.readText(`${WORKDIR}/capture.json`)) as CapturedPageEvidence;
      if (!/^[a-f0-9]{64}$/.test(evidence.source_hash)) throw new Error("SUPERSERVE_CAPTURE_INVALID");
      if (
        evidence.source_url !== plan.sourceUrl ||
        evidence.desktop_screenshot_path !== `${WORKDIR}/desktop.png` ||
        evidence.mobile_screenshot_path !== `${WORKDIR}/mobile.png` ||
        !evidence.reduced_dom ||
        !evidence.visible_text
      ) {
        throw new Error("SUPERSERVE_CAPTURE_INVALID");
      }
      await sandbox.pause();
      return { ...evidence, sandbox_id: sandbox.id };
    } catch (error) {
      try {
        await sandbox.kill();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "SUPERSERVE_CAPTURE_AND_CLEANUP_FAILED");
      }
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

export interface SuperserveWorkSurfaceOptions {
  template: string;
  previewPort: number;
  previewExpirySeconds: number;
  timeoutSeconds: number;
  autoDeleteSeconds: number;
}

function configuredPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const candidate = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > maximum) return fallback;
  return candidate;
}

export class SuperserveWorkSurfaceAdapter {
  constructor(
    private readonly factory: SuperserveSandboxFactory = defaultSuperserveSandboxFactory,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: SuperserveWorkSurfaceOptions = {
      template: process.env.SUPERSERVE_TEMPLATE ?? "",
      previewPort: configuredPositiveInteger(process.env.SUPERSERVE_PREVIEW_PORT, PREVIEW_PORT, 65_535),
      previewExpirySeconds: PREVIEW_EXPIRY_SECONDS,
      timeoutSeconds: configuredPositiveInteger(process.env.SUPERSERVE_TIMEOUT_SECONDS, 3_600, 86_400),
      autoDeleteSeconds: configuredPositiveInteger(process.env.SUPERSERVE_AUTO_DELETE_SECONDS, 86_400, 604_800),
    },
  ) {}

  async open(request: OpenWorkSurfacesRequest): Promise<readonly [OperatorSandboxSurface, OperatorSandboxSurface]> {
    if (request.operatorAuthorized !== true) throw new Error("OPERATOR_ACCESS_REQUIRED");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.jobId)) throw new Error("JOB_ID_INVALID");
    const template = this.options.template.trim();
    if (!template) throw new Error("SUPERSERVE_TEMPLATE_REQUIRED");
    if (
      !Number.isInteger(this.options.previewPort) ||
      this.options.previewPort < 1_024 ||
      this.options.previewPort > 65_535 ||
      this.options.previewPort === 49_983
    ) {
      throw new Error("SUPERSERVE_PREVIEW_PORT_INVALID");
    }
    const source = new URL(request.sourceUrl);
    if (!/^https?:$/.test(source.protocol)) throw new Error("SOURCE_URL_INVALID");
    const variants = [
      { label: "A" as const, task: "Reproduce captured paywall", spec: validatePaywallSpec(request.control) },
      { label: "B" as const, task: "Apply one controlled change", spec: validatePaywallSpec(request.challenger) },
    ];
    const created: SuperserveSandboxInstance[] = [];

    try {
      const surfaces = await Promise.all(variants.map(async (variant): Promise<OperatorSandboxSurface> => {
        const sandbox = await this.factory.create({
          name: `paybench-${request.jobId.slice(0, 8)}-${variant.label.toLowerCase()}`,
          fromTemplate: template,
          timeoutSeconds: this.options.timeoutSeconds,
          autoDeleteSeconds: this.options.autoDeleteSeconds,
          previewAccess: "private",
          metadata: { app: "paybench", job_id: request.jobId, variant: variant.label, visibility: "operator-only" },
          network: {
            // These previews contain no credentials and serve only validated,
            // static PaywallSpec data. Keeping normal egress avoids severing
            // the SDK data plane with a deny-all rule.
            allowOut: ["0.0.0.0/0"],
            denyOut: [],
          },
        });
        created.push(sandbox);
        await sandbox.files.write(`${WORKDIR}/variant.json`, JSON.stringify(variant.spec));
        await sandbox.files.write(`${WORKDIR}/server.mjs`, SANDBOX_SERVER_SOURCE);
        const launch = await sandbox.commands.run(
          `sh -lc 'nohup env PAYBENCH_PREVIEW_PORT=${this.options.previewPort} node ${WORKDIR}/server.mjs > ${WORKDIR}/server.log 2>&1 < /dev/null & echo $!'`,
          { cwd: WORKDIR, timeoutMs: 10_000 },
        );
        if (launch.exitCode !== 0 || !/^\d+$/.test(launch.stdout.trim())) {
          throw new Error(`SUPERSERVE_PREVIEW_START_FAILED:${variant.label}`);
        }
        const readiness = await sandbox.commands.run(
          `node -e "let n=0;const check=()=>fetch('http://127.0.0.1:${this.options.previewPort}/healthz').then(async r=>{if(!r.ok||await r.text()!=='ready')throw 0;process.exit(0)}).catch(()=>{if(++n>=${PREVIEW_READY_ATTEMPTS})process.exit(1);setTimeout(check,${PREVIEW_READY_DELAY_MS})});check()"`,
          { cwd: WORKDIR, timeoutMs: 10_000 },
        );
        if (readiness.exitCode !== 0) {
          const log = sandbox.files.readText
            ? (await sandbox.files.readText(`${WORKDIR}/server.log`)).trim().slice(0, 500)
            : "";
          throw new Error(`SUPERSERVE_PREVIEW_NOT_READY:${variant.label}${log ? `:${log}` : ""}`);
        }
        const info = await sandbox.getInfo();
        if (info.id !== sandbox.id || info.status !== "active") throw new Error("SUPERSERVE_SANDBOX_NOT_ACTIVE");
        const published = await sandbox.publishPreviewPort(this.options.previewPort, { access: "private" });
        if (published.port !== this.options.previewPort || published.access !== "private") {
          throw new Error("SUPERSERVE_PREVIEW_NOT_PRIVATE");
        }
        const preview = new URL(await sandbox.getSignedPreviewUrl(this.options.previewPort, {
          expiresInSeconds: this.options.previewExpirySeconds,
        }));
        if (preview.protocol !== "https:") throw new Error("SUPERSERVE_PREVIEW_NOT_HTTPS");
        if (![...preview.searchParams.keys()].some((key) => key.toLowerCase().includes("token"))) {
          throw new Error("SUPERSERVE_PREVIEW_UNSIGNED");
        }
        return {
          variant: variant.label,
          sandbox_id: sandbox.id,
          status: "ready",
          task: variant.task,
          preview_url: preview.toString(),
          last_activity_at: this.clock().toISOString(),
          operator_only: true,
        };
      }));
      return surfaces as unknown as readonly [OperatorSandboxSurface, OperatorSandboxSurface];
    } catch (error) {
      const cleanup = await Promise.allSettled(created.map((sandbox) => sandbox.kill()));
      const cleanupErrors = cleanup.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (cleanupErrors.length > 0) {
        throw new AggregateError([error, ...cleanupErrors], "SUPERSERVE_SURFACE_AND_CLEANUP_FAILED");
      }
      throw error;
    }
  }
}
