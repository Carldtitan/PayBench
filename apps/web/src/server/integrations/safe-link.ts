import "./server-only";

export interface ExpiringLink {
  url: string;
  expires_at: string;
}

export function activeHttpsUrl(
  link: ExpiringLink | undefined,
  observedAt: string,
): string | undefined {
  if (!link) {
    return undefined;
  }

  try {
    const url = new URL(link.url);
    const expiresAt = new Date(link.expires_at);
    const observed = new Date(observedAt);

    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      Number.isNaN(expiresAt.getTime()) ||
      Number.isNaN(observed.getTime()) ||
      expiresAt.getTime() <= observed.getTime()
    ) {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}
