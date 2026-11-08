import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:5173/Speed-Printer/",
    viewport: { width: 1672, height: 941 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173/Speed-Printer/",
    reuseExistingServer: !process.env.CI,
  },
});
