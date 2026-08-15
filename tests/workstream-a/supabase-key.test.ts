import { describe, expect, it } from "vitest";

import {
  SupabaseControlTransport,
  resolveSupabaseServerKey,
} from "../../apps/web/src/server/control/supabase-repository";

describe("Supabase server credential resolution", () => {
  it("uses a valid configured server key without a management call", async () => {
    let calls = 0;
    const key = await resolveSupabaseServerKey(
      { SUPABASE_SECRET_KEY: `sb_secret_${"x".repeat(30)}` },
      async () => {
        calls += 1;
        return new Response("[]");
      },
    );
    expect(key.startsWith("sb_secret_")).toBe(true);
    expect(calls).toBe(0);
  });

  it("retrieves service_role only with the server-side management credentials", async () => {
    const key = await resolveSupabaseServerKey(
      { SUPABASE_ACCESS_TOKEN: "management-token", SUPABASE_PROJECT_REF: "project-ref" },
      async (_input, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer management-token");
        return Response.json([{ name: "anon", api_key: "public" }, { name: "service_role", api_key: "server-role-value" }]);
      },
    );
    expect(key).toBe("server-role-value");
  });
});

describe("Supabase control transport", () => {
  it("accepts an empty 201 response for return-minimal inserts", async () => {
    const transport = new SupabaseControlTransport(
      "https://example.supabase.co",
      `sb_secret_${"x".repeat(30)}`,
      async () => new Response(null, { status: 201 }),
    );
    await expect(
      transport.request("POST", "webhook_events", {}, { provider: "stripe" }, "return=minimal"),
    ).resolves.toEqual([]);
  });
});
