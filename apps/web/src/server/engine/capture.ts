import "./server-only";

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export const SAFE_CAPTURE_LIMITS = Object.freeze({
  maxRedirects: 5,
  timeoutMs: 30_000,
  maxResponseBytes: 20 * 1024 * 1024,
  desktopViewport: { width: 1440, height: 960 },
  mobileViewport: { width: 390, height: 844 },
});

export interface CaptureEvidencePlan {
  sourceUrl: string;
  limits: typeof SAFE_CAPTURE_LIMITS;
  captures: readonly ["desktop_screenshot", "mobile_screenshot", "reduced_dom", "visible_text", "brand_tokens"];
  browserRules: {
    blockDownloads: true;
    blockPopups: true;
    blockPermissions: true;
    blockExternalProtocols: true;
    stopBeforeAccountTrialOrderOrCharge: true;
    executeSourceScriptsInSandbox: true;
    copySourceScriptsToGeneratedPage: false;
  };
}

export interface HostResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

const defaultResolver: HostResolver = {
  async resolve(hostname) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  },
};

export class CaptureSafetyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CaptureSafetyError";
  }
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isForbiddenIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1];
  return mapped ? isForbiddenIpv4(mapped) : false;
}

export function isForbiddenNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isForbiddenIpv4(address);
  if (version === 6) return isForbiddenIpv6(address);
  return true;
}

function parseCaptureUrl(rawUrl: string): URL {
  if (rawUrl.length > 2_048) throw new CaptureSafetyError("URL_TOO_LONG", "Capture URL is too long");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CaptureSafetyError("URL_INVALID", "Capture URL is invalid");
  }
  if (!/^https?:$/.test(url.protocol)) throw new CaptureSafetyError("URL_PROTOCOL_BLOCKED", "Only HTTP and HTTPS are allowed");
  if (url.username || url.password) throw new CaptureSafetyError("URL_CREDENTIALS_BLOCKED", "Embedded URL credentials are forbidden");
  if (!url.hostname || url.hostname.length > 253) throw new CaptureSafetyError("URL_HOST_INVALID", "Capture host is invalid");
  if (url.port && !["80", "443"].includes(url.port)) throw new CaptureSafetyError("URL_PORT_BLOCKED", "Only standard web ports are allowed");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new CaptureSafetyError("URL_HOST_BLOCKED", "Local and internal hosts are forbidden");
  }
  return url;
}

export async function validatePublicCaptureUrl(
  rawUrl: string,
  resolver: HostResolver = defaultResolver,
): Promise<URL> {
  const url = parseCaptureUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolver.resolve(host);
  if (addresses.length === 0) throw new CaptureSafetyError("URL_DNS_EMPTY", "Capture host did not resolve");
  if (addresses.some(isForbiddenNetworkAddress)) {
    throw new CaptureSafetyError("URL_NETWORK_BLOCKED", "Capture host resolves to a forbidden network");
  }
  return url;
}

export async function validateCaptureRedirectChain(
  urls: readonly string[],
  resolver: HostResolver = defaultResolver,
): Promise<URL[]> {
  if (urls.length === 0) throw new CaptureSafetyError("REDIRECT_CHAIN_EMPTY", "Capture requires a starting URL");
  if (urls.length - 1 > SAFE_CAPTURE_LIMITS.maxRedirects) {
    throw new CaptureSafetyError("REDIRECT_LIMIT", "Capture exceeded five redirects");
  }
  const validated: URL[] = [];
  for (const url of urls) validated.push(await validatePublicCaptureUrl(url, resolver));
  return validated;
}

export async function createCaptureEvidencePlan(
  sourceUrl: string,
  resolver: HostResolver = defaultResolver,
): Promise<CaptureEvidencePlan> {
  const validated = await validatePublicCaptureUrl(sourceUrl, resolver);
  return {
    sourceUrl: validated.toString(),
    limits: SAFE_CAPTURE_LIMITS,
    captures: ["desktop_screenshot", "mobile_screenshot", "reduced_dom", "visible_text", "brand_tokens"],
    browserRules: {
      blockDownloads: true,
      blockPopups: true,
      blockPermissions: true,
      blockExternalProtocols: true,
      stopBeforeAccountTrialOrderOrCharge: true,
      executeSourceScriptsInSandbox: true,
      copySourceScriptsToGeneratedPage: false,
    },
  };
}
