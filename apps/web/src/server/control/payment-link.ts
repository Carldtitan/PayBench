import { ControlError } from "./types";

export function paymentLinkForJob(baseLink: string | undefined, jobId: string): string {
  if (!baseLink) throw new ControlError("STRIPE_PAYMENT_LINK_NOT_CONFIGURED", 503);
  let url: URL;
  try {
    url = new URL(baseLink);
  } catch {
    throw new ControlError("STRIPE_PAYMENT_LINK_INVALID", 503);
  }
  if (url.protocol !== "https:" || url.hostname !== "buy.stripe.com") {
    throw new ControlError("STRIPE_PAYMENT_LINK_INVALID", 503);
  }
  url.searchParams.set("client_reference_id", jobId);
  return url.toString();
}

