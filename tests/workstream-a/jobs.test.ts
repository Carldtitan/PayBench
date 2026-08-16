import { describe, expect, it } from "vitest";

import { createFounderJob } from "../../apps/web/src/server/control/jobs";
import { MemoryControlRepository } from "../../apps/web/src/server/control/memory-repository";
import { validatePublicWebsiteUrl } from "../../apps/web/src/server/control/url";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("founder job intake", () => {
  it("starts every valid public URL without a payment gate", async () => {
    const repository = new MemoryControlRepository();
    const created = await createFounderJob(
      {
        website_url: "https://example.com/pricing#plans",
        target_customer_description: "Operations leads at small software companies.",
      },
      repository,
      { resolver: publicResolver, paymentLink: "https://buy.stripe.com/paybench" },
    );

    expect(created.website_url).toBe("https://example.com/pricing");
    expect(created.status).toBe("paid");
    expect(created.access).toBe("granted");
    expect(created).not.toHaveProperty("payment_url");
    expect((await repository.getJob(created.job_id))?.target_customer_description).toContain("Operations leads");
  });

  it("rejects private, local, credentialed, and mixed DNS targets", async () => {
    await expect(validatePublicWebsiteUrl("http://127.0.0.1/admin")).rejects.toMatchObject({ code: "WEBSITE_URL_PRIVATE_ADDRESS" });
    await expect(validatePublicWebsiteUrl("https://user:pass@example.com", publicResolver)).rejects.toMatchObject({ code: "WEBSITE_URL_CREDENTIALS" });
    await expect(
      validatePublicWebsiteUrl("https://example.com", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.4", family: 4 },
      ]),
    ).rejects.toMatchObject({ code: "WEBSITE_URL_PRIVATE_ADDRESS" });
  });
});
