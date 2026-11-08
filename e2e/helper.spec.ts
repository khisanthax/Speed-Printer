import { expect, test } from "@playwright/test";
import { demoBundle } from "../src/domain";
test("helper lifecycle ignores stale jobs and replaces estimates only on completion", async ({
  page,
}) => {
  let slices = 0;
  let releaseOldTuning = false;
  await page.route("http://127.0.0.1:8377/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let result: unknown = {};
    if (path === "/health") result = { orcaFound: true };
    if (path === "/model") result = { id: "model", name: "test-cube.stl" };
    if (path === "/slice") result = { id: String(++slices) };
    if (path.startsWith("/jobs/")) {
      const id = path.split("/").pop();
      result =
        id === "2" && !releaseOldTuning
          ? { state: "running" }
          : {
              state: "complete",
              result: {
                seconds: id === "1" ? 600 : id === "2" ? 9999 : 120,
                grams: 2,
                source: "TEST ONLY fake engine",
                modelHash: "test",
                settingsHash: "test",
              },
            };
    }
    await route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify(result),
    });
  });
  await page.goto("");
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.locator("#token").fill("test-session-token");
  await page.locator("#pair").click();
  await expect(page.locator("#pair-status")).toContainText("Connected");
  await page
    .getByRole("button", { name: "Compare & Tune", exact: false })
    .click();
  await page.locator('[data-import="0"]').click();
  await page.locator("#manual-import").click();
  const b = demoBundle();
  b.machine.name = "Fixture machine";
  b.process.name = "Fixture process";
  b.filament.name = "Fixture filament";
  await page.locator("#file").setInputFiles({
    name: "fixtures.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(Object.values(b))),
  });
  for (const kind of ["machine", "process", "filament"])
    await page
      .locator(`#pick-${kind}`)
      .selectOption({ label: `Fixture ${kind}` });
  await page.locator("#apply-import").click();
  await page.locator("#choose-model").click();
  await page.locator('[data-slice="0"]').click();
  await expect(page.locator("#summary-0 .time-metric strong")).toHaveText(
    "0 h 10 min",
  );
  await page
    .getByRole("spinbutton", { name: "Outer wall speed value" })
    .fill("250");
  await expect.poll(() => slices).toBe(2);
  await expect(page.locator("#summary-2 .time-metric strong")).toHaveText("—");
  await page
    .getByRole("spinbutton", { name: "Outer wall speed value" })
    .fill("260");
  await expect(page.locator("#summary-2")).toContainText(
    "latest changes queued",
  );
  expect(slices).toBe(2);
  await page
    .getByRole("spinbutton", { name: "Outer wall speed value" })
    .fill("270");
  await expect(page.locator("#number-outer_wall_speed")).toHaveValue("270");
  releaseOldTuning = true;
  await expect.poll(() => slices).toBe(3);
  await expect(page.locator("#summary-2 .time-metric strong")).toHaveText(
    "0 h 2 min",
  );
  await page.locator('[data-slice="0"]').click();
  await expect.poll(() => slices).toBe(4);
  await expect(page.locator("#summary-2")).toContainText(
    "Verified local slice",
  );
  await page.waitForTimeout(600);
  await expect(page.locator("#summary-2 .time-metric strong")).toHaveText(
    "0 h 2 min",
  );
});
