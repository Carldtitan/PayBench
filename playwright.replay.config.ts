import { defineConfig } from "@playwright/test";
import {
  devices as replayDevices,
  replayReporter,
} from "@replayio/playwright";

const apiKey = process.env.REPLAY_API_KEY;

export default defineConfig({
  testDir: "./e2e/replay",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    replayReporter({
      apiKey,
      upload: true,
    }),
    ["line"],
    ["json", { outputFile: "test-results/replay-results.json" }],
  ],
  use: {
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "replay-chromium",
      use: {
        ...replayDevices["Replay Chromium"],
      },
    },
  ],
});
