import { defineConfig } from "@playwright/test";
import {
  devices as replayDevices,
  replayReporter,
} from "@replayio/playwright";

const apiKey = process.env.REPLAY_QA_API_TOKEN ?? process.env.REPLAY_API_KEY;

export default defineConfig({
  testDir: "./tests/replay",
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
