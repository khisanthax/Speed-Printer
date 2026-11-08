import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
test("real browser → authenticated helper → installed Orca → verified summary", async ({
  page,
}) => {
  test.skip(
    !process.env.SPEED_PRINTER_LIVE_ORCA,
    "Opt-in test requires an installed OrcaSlicer; no private profiles are read.",
  );
  test.setTimeout(180_000);
  const child = spawn(
    "python",
    ["e2e/fixture_helper.py", process.env.SPEED_PRINTER_LIVE_ORCA!],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  try {
    const token = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timeout = setTimeout(
        () => reject(new Error("Fixture helper failed to start")),
        15000,
      );
      child.stdout.on("data", (data) => {
        text += data.toString();
        if (text.includes("\n")) {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(text.split("\n")[0]).token);
          } catch {
            reject(new Error("Invalid fixture handshake"));
          }
        }
      });
      child.on("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Fixture helper exited"));
      });
    });
    await page.goto("");
    await page.locator('[data-nav="Settings"]').click();
    await page.locator("#token").fill(token);
    await page.locator("#pair").click();
    await expect(page.locator("#pair-status")).toContainText("Connected");
    await page.locator('[data-nav="Compare & Tune"]').click();
    await page.locator('[data-import="0"]').click();
    await page.locator("#local-import").click();
    await page
      .locator("#pick-machine")
      .selectOption({ label: "Sovol SV08 0.4 nozzle" });
    await page
      .locator("#pick-process")
      .selectOption({ label: "0.20mm Standard @Sovol SV08" });
    const filament = page
      .locator("#pick-filament option")
      .filter({ hasText: /^Generic PLA @Sovol SV08$/ });
    await page
      .locator("#pick-filament")
      .selectOption(
        (await filament.count())
          ? { label: "Generic PLA @Sovol SV08" }
          : { label: "Sovol SV08 PLA" },
      );
    await page.locator("#apply-import").click();
    await page.locator("#choose-model").click();
    await expect(page.locator("#model-name")).toHaveText("cube.stl");
    await page.locator('[data-slice="0"]').click();
    await expect(page.locator("#summary-0")).toContainText(
      "Verified local slice",
      { timeout: 120000 },
    );
    await expect(page.locator("#summary-0 .time-metric strong")).not.toHaveText(
      "—",
    );
    await page.locator("#reslice").click();
    await expect(page.locator("#summary-2")).toContainText(
      "Verified local slice",
      { timeout: 120000 },
    );
    await expect(page.locator("#summary-2 .time-metric strong")).toHaveText(
      await page.locator("#summary-0 .time-metric strong").innerText(),
    );
    await page.screenshot({
      path: ".local/real-orca-browser.png",
      fullPage: true,
    });
  } finally {
    child.kill();
  }
});
