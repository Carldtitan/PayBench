import type { HostResolver } from "./url";
import { validatePublicWebsiteUrl, validateTargetCustomerDescription } from "./url";
import type { ControlRepository } from "./types";

export async function createFounderJob(
  input: { website_url?: unknown; target_customer_description?: unknown },
  repository: ControlRepository,
  options: {
    resolver?: HostResolver;
    paymentLink?: string;
  } = {},
) {
  const websiteUrl = await validatePublicWebsiteUrl(input.website_url, options.resolver);
  const targetCustomer = validateTargetCustomerDescription(input.target_customer_description);
  const job = await repository.createJob({
    website_url: websiteUrl,
    target_customer_description: targetCustomer,
    initial_status: "paid",
  });
  return {
    job_id: job.id,
    website_url: job.website_url,
    target_customer_description: job.target_customer_description,
    status: job.status,
    access: "granted",
  };
}
