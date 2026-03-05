import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://clawsoc.fly.dev",
    browserName: "chromium",
    headless: true,
  },
});
