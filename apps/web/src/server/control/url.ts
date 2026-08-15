import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { ControlError } from "./types";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const defaultResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function publicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function publicIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) return publicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return false;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? publicIpv4(mapped[1]) : true;
}

export function validateTargetCustomerDescription(value: unknown): string {
  if (typeof value !== "string") throw new ControlError("TARGET_CUSTOMER_REQUIRED");
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < 20 || normalized.length > 500) {
    throw new ControlError("TARGET_CUSTOMER_LENGTH");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) {
    throw new ControlError("TARGET_CUSTOMER_INVALID");
  }
  return normalized;
}

export async function validatePublicWebsiteUrl(
  value: unknown,
  resolver: HostResolver = defaultResolver,
): Promise<string> {
  if (typeof value !== "string" || value.length > 2048) {
    throw new ControlError("WEBSITE_URL_INVALID");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ControlError("WEBSITE_URL_INVALID");
  }

  if (!['https:', 'http:'].includes(url.protocol)) throw new ControlError("WEBSITE_URL_PROTOCOL");
  if (url.username || url.password) throw new ControlError("WEBSITE_URL_CREDENTIALS");
  if (url.port && !['80', '443'].includes(url.port)) throw new ControlError("WEBSITE_URL_PORT");
  url.hash = "";

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new ControlError("WEBSITE_URL_PRIVATE_HOST");
  }

  if (isIP(hostname)) {
    if (!publicIp(hostname)) throw new ControlError("WEBSITE_URL_PRIVATE_ADDRESS");
  } else {
    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await resolver(hostname);
    } catch {
      throw new ControlError("WEBSITE_URL_DNS_FAILED");
    }
    if (addresses.length === 0 || addresses.some((entry) => !publicIp(entry.address))) {
      throw new ControlError("WEBSITE_URL_PRIVATE_ADDRESS");
    }
  }

  return url.toString();
}

