import { defineConfig, devices } from "@playwright/test";

// Runs the built extension (dist/) in Safari's engine against recorded network data.
// Run `npm run build` first. Locally, `--project=chromium` works where WebKit can't be installed.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The real build/chrome extension in Chromium (run `npm run build:all` first).
    { name: "chrome-extension", testDir: "tests/extension", testMatch: "**/*.spec.ts" },
  ],
});
