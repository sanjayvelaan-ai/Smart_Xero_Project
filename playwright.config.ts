import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3217";
const systemChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = process.env.PLAYWRIGHT_CHROME ?? (process.platform === "win32" && existsSync(systemChrome) ? systemChrome : undefined);
let directory: string | undefined;
if (!process.env.PLAYWRIGHT_BASE_URL) {
  mkdirSync(".printflow/playwright", { recursive: true });
  directory = mkdtempSync(path.resolve(".printflow/playwright/run-"));
}
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 75000,
  expect: { timeout: 15000 },
  workers: 1,
  use: { baseURL, browserName: "chromium", launchOptions: { executablePath: browser, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: directory ? {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3217",
    url: baseURL + "/api/shops/printflow-demo",
    timeout: 90000,
    env: { PRINTFLOW_PROTOTYPE_LOGIN: "true", PRINTFLOW_LOCAL_OWNER_PASSWORD:"browser-test-password", PRINTFLOW_DATA_DIR: directory, DATABASE_URL: "", PRINTFLOW_OWNER_PASSWORD: "", PRINTFLOW_PUBLIC_ORIGIN: "", NEXT_TELEMETRY_DISABLED: "1" },
  } : undefined,
});
