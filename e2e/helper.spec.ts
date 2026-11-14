import { expect, test, type Page } from "@playwright/test";
import { demoBundle, type Bundle } from "../src/domain";

async function setup(page: Page) {
  const jobs: { bundle: Bundle; model: string }[] = [];
  const blocked = new Set<number>(),
    failed = new Set<number>();
  let model = 0,
    active = 0,
    maxActive = 0;
  await page.route("http://127.0.0.1:8377/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    let result: unknown = {};
    if (path === "/auth/challenge") result = { legacySession: true };
    if (path === "/health") result = { orcaFound: true, sharedLayout: true };
    if (path === "/model") {
      expect(route.request().postDataJSON().bundles).toHaveLength(3);
      result = { id: "model-" + ++model, name: `project-${model}.3mf` };
    }
    if (path === "/slice") {
      jobs.push(route.request().postDataJSON());
      active++;
      maxActive = Math.max(active, maxActive);
      result = { id: String(jobs.length) };
    }
    if (path.startsWith("/jobs/")) {
      const id = Number(path.split("/").pop());
      if (Number.isFinite(id)) {
        const job = jobs[id - 1];
        result = blocked.has(id)
          ? { state: "running" }
          : failed.has(id)
            ? { state: "failed", error: "Orca could not slice these settings" }
            : {
                state: "complete",
                result: {
                  seconds: 1000 - Number(job.bundle.process.outer_wall_speed),
                  grams: 2,
                  source: "TEST ONLY synthetic engine",
                  modelHash: job.model,
                  layoutHash: "layout-" + job.model,
                  objectCount: 2,
                  projectObjectCount: 2,
                },
              };
        if (!blocked.has(id)) active = Math.max(0, active - 1);
      }
    }
    if (path === "/export-project") result = { id: "export" };
    if (path === "/jobs/export")
      result = {
        state: "complete",
        result: { seconds: 100, exportedProject: "comparison.3mf" },
      };
    if (path === "/analyze") result = { id: "analysis" };
    if (path === "/jobs/analysis")
      result = {
        state: "complete",
        result: {
          effects: [
            {
              key: "outer_wall_speed",
              savedSeconds: 15,
              conditionalSavedSeconds: 15,
            },
          ],
          combinedSeconds: 100,
          interactionResidualSeconds: 0,
          method: "TEST ONLY synthetic analysis",
        },
      };
    if (path === "/install") {
      const bundle = structuredClone(route.request().postDataJSON().bundle);
      for (const kind of ["machine", "process", "filament"] as const)
        bundle[kind].name = "Installed " + kind;
      result = { installed: [], bundle };
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("");
  await page.locator('[data-nav="Settings"]').click();
  await page.locator("#token").fill("test-session-token");
  await page.locator("#pair").click();
  await expect(page.locator("#pair-status")).toContainText("Connected");
  await page.locator('[data-nav="Compare & Tune"]').click();
  for (const i of [0, 1]) {
    const b = demoBundle(Boolean(i));
    for (const kind of ["machine", "process", "filament"] as const)
      b[kind].name = `${i ? "Target" : "Fixture"} ${kind}`;
    await page.locator(`[data-import="${i}"]`).click();
    await page.locator("#manual-import").click();
    await page
      .locator("#file")
      .setInputFiles({
        name: "fixtures.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(Object.values(b))),
      });
    for (const kind of ["machine", "process", "filament"])
      await page
        .locator(`#pick-${kind}`)
        .selectOption({ label: `${i ? "Target" : "Fixture"} ${kind}` });
    await page.locator("#apply-import").click();
  }
  const verified = () =>
    expect(page.locator("#summary-2 .result-status")).toContainText(
      "Verified local slice",
    );
  return {
    jobs,
    blocked,
    failed,
    verified,
    get modelCount() {
      return model;
    },
    get maxActive() {
      return maxActive;
    },
  };
}

test("one model selection slices A and B and reuses identical C; numeric buttons auto-slice", async ({
  page,
}) => {
  const s = await setup(page);
  await expect(
    page.getByRole("button", { name: /Slice current|Slice target|Re-slice/ }),
  ).toHaveCount(0);
  await page.locator("#choose-model").click();
  await s.verified();
  expect(s.jobs).toHaveLength(2);
  expect(s.maxActive).toBe(1);
  await expect(page.locator("#model-name")).toHaveText("project-1.3mf");
  await expect(page.locator("#summary-0 .time-value small")).toContainText(
    "800 s",
  );
  await expect(page.locator("#summary-1 .time-value small")).toContainText(
    "700 s",
  );
  await expect(page.locator("#summary-2")).toContainText(
    "identical source result reused",
  );
  await page
    .getByRole("button", { name: "Increase Outer wall speed", exact: true })
    .click();
  await expect(page.locator("#number-outer_wall_speed")).toHaveValue("201");
  await expect(page.locator("#summary-2")).toContainText(
    "Stale — recalculating",
  );
  await s.verified();
  expect(s.jobs.at(-1)!.bundle.process.outer_wall_speed).toBe("201");
  await expect(page.locator("#summary-0 .time-value small")).toContainText(
    "800 s",
  );
  await expect(page.locator("#summary-1 .time-value small")).toContainText(
    "700 s",
  );
  await page
    .getByRole("button", { name: "Decrease Outer wall speed", exact: true })
    .click();
  await expect(page.locator("#number-outer_wall_speed")).toHaveValue("200");
  await s.verified();
  await expect(page.locator("#summary-2 .time-value small")).toContainText(
    "800 s",
  );
  await page
    .getByRole("button", { name: "Increase Max volumetric flow", exact: true })
    .click();
  await expect(
    page.locator("#number-filament_max_volumetric_speed"),
  ).toHaveValue("24.1");
  await s.verified();
  await page.locator("#number-layer_height").fill("0.05");
  await expect(
    page.getByRole("button", { name: "Decrease Layer height", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Increase Layer height", exact: true })
    .click();
  await expect(page.locator("#number-layer_height")).toHaveValue("0.06");
  await s.verified();
  const selects = s.modelCount;
  await page.locator("#slice-all").click();
  await s.verified();
  expect(s.modelCount).toBe(selects);
});

test("debounce keeps only latest C while a job runs and never replaces baselines", async ({
  page,
}) => {
  const s = await setup(page);
  await page.locator("#choose-model").click();
  await s.verified();
  s.blocked.add(3);
  s.blocked.add(4);
  await page.locator("#number-outer_wall_speed").fill("250");
  await expect.poll(() => s.jobs.length).toBe(3);
  await expect(
    page.getByRole("progressbar", { name: "Live tuning slicing progress" }),
  ).toBeVisible();
  for (const value of ["251", "260", "270"])
    await page.locator("#number-outer_wall_speed").fill(value);
  await expect(page.locator("#summary-2")).toContainText(
    "latest changes queued",
  );
  await page.waitForTimeout(750);
  expect(s.jobs).toHaveLength(3);
  s.blocked.delete(3);
  await expect.poll(() => s.jobs.length).toBe(4);
  expect(s.jobs[3].bundle.process.outer_wall_speed).toBe("270");
  await expect(page.locator("#summary-2 .time-value small")).toContainText(
    "800 s",
  );
  await expect(page.locator("#summary-2")).not.toContainText(
    "Verified local slice",
  );
  s.blocked.delete(4);
  await s.verified();
  await expect(page.locator("#summary-2 .time-value small")).toContainText(
    "730 s",
  );
  expect(s.maxActive).toBe(1);
  await expect(page.locator("#summary-0 .time-value small")).toContainText(
    "800 s",
  );
  await expect(page.locator("#summary-1 .time-value small")).toContainText(
    "700 s",
  );
});

test("model switch invalidates old jobs; failure cannot masquerade as a verified C result", async ({
  page,
}) => {
  const s = await setup(page);
  await page.locator("#choose-model").click();
  await s.verified();
  s.blocked.add(3);
  await page.locator("#number-outer_wall_speed").fill("250");
  await expect.poll(() => s.jobs.length).toBe(3);
  await page.locator("#choose-model").click();
  await expect(page.locator("#model-name")).toHaveText("project-2.3mf");
  for (const i of [0, 1, 2])
    await expect(page.locator(`#summary-${i}`)).not.toContainText(
      "Verified local slice",
    );
  s.blocked.delete(3);
  await s.verified();
  expect(s.jobs.slice(3).every((j) => j.model === "model-2")).toBe(true);
  const next = s.jobs.length + 1;
  s.failed.add(next);
  await page.locator("#number-outer_wall_speed").fill("280");
  await expect(page.locator("#summary-2")).toContainText(
    "Slice failed — Orca could not slice",
  );
  await expect(page.locator("#summary-2 .time-metric strong")).toHaveText("—");
  await expect(page.locator("#summary-2")).not.toContainText(
    "Verified local slice",
  );
  await expect(page.locator("#summary-0")).toContainText(
    "Verified local slice",
  );
});

test("refresh, export, analysis, installation and conditions retain the shared slice path", async ({
  page,
}) => {
  const s = await setup(page);
  await page.locator("#choose-model").click();
  await s.verified();
  await page.locator("#refresh-library").click();
  await page.locator("#number-outer_wall_speed").fill("240");
  await s.verified();
  await page.locator("#export-project").click();
  await expect(page.locator("#toast")).toContainText(
    "Verified project exported: comparison.3mf",
  );
  await page.locator("#analyze").click();
  await page.locator("#run-analysis").click();
  await expect(page.locator("#analysis-result")).toContainText("15.0");
  await page.locator("#apply-analysis").click();
  await s.verified();
  await expect(page.locator("#number-outer_wall_speed")).toHaveValue("300");
  await page.locator("#install").click();
  await page.locator("#confirm-install").click();
  await s.verified();
  await expect
    .poll(() => s.jobs.at(-1)!.bundle.machine.name)
    .toBe("Installed machine");
  await page
    .getByRole("button", { name: "Compare conditions", exact: true })
    .click();
  await page.locator("#common-process").click();
  await expect(page.locator(".col-1 .profile-info")).toContainText(
    "Fixture process",
  );
  await page
    .getByRole("button", { name: "Compare conditions", exact: true })
    .click();
  await page.locator("#restore-process").click();
  await expect(page.locator(".col-1 .profile-info")).toContainText(
    "Target process",
  );
});
