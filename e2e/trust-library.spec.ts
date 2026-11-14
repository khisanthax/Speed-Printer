import { expect, test } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { demoBundle } from "../src/domain";

test("real browser signing key, restart trust, curated refresh and immutable experiment", async ({
  page,
}) => {
  let token = "",
    trusted: JsonWebKey | undefined,
    challenge = "",
    permission = false,
    pairs = 0,
    revoked = false;
  const source = demoBundle();
  for (const [kind, p] of Object.entries(source)) {
    p.__sp_id = kind;
    p.__sp_hash = "version-one";
    p.__sp_source = "User";
    p.name = "Fixture " + kind;
    p.inherits = "";
  }
  const library = () => ({
    imported: permission,
    profiles: permission ? Object.values(source) : [],
    printers: permission
      ? [
          {
            id: "machine",
            name: source.machine.name,
            source: "User",
            current: true,
            remembered: true,
            selected: { process: "process", filament: "filament" },
            process: [
              {
                id: "process",
                name: source.process.name,
                source: "User",
                compatibility: "matched",
              },
            ],
            filament: [
              {
                id: "filament",
                name: source.filament.name,
                source: "User",
                compatibility: "matched",
              },
            ],
          },
        ]
      : [],
  });
  let workspace: unknown = {};
  await page.route("http://127.0.0.1:8377/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    const body = route.request().postDataJSON();
    let result: unknown = {},
      status = 200;
    if (path === "/discover") result = {instance:"fixture-helper",approval:true};
    else if (path === "/auth/challenge") {
      challenge = crypto.randomUUID();
      result = { id: challenge, message: challenge, paired:!!trusted,revoked };
    } else if (path === "/auth/pair" || path === "/auth/resume" || path === "/auth/approve") {
      const jwk = path !== "/auth/resume" ? body.publicKey : trusted;
      let valid = false;
      if (jwk && body.challenge === challenge) {
        const key = await webcrypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
        valid = await webcrypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          Buffer.from(body.signature, "base64url"),
          new TextEncoder().encode(challenge),
        );
      }
      if (valid && !revoked && (path !== "/auth/pair" || body.code === "fixture-code")) {
        trusted = jwk;
        token = crypto.randomUUID();
        result = { token };
        if (path !== "/auth/resume") pairs++;
      } else {
        status = 400;
        result = { error: "Pairing required" };
      }
      challenge = "";
    } else if (
      !token ||
      route.request().headers().authorization !== "Bearer " + token
    ) {
      status = 403;
      result = { error: "Session expired" };
    } else if (path === "/auth/revoke") { trusted=undefined;token="";revoked=true;result={revoked:true}; }
    else if (path === "/health") result = { orcaFound: true };
    else if (path === "/library") result = library();
    else if (path === "/profiles") {
      permission = true;
      result = library();
    } else if (path === "/workspace") {
      if (body) workspace = body;
      result = workspace;
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("");
  await expect(page.locator("#connection-state")).toHaveText("Local helper connected");
  await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
  // First native approval was discovered automatically; no code or connect click.
  expect(pairs).toBe(1);
  await page.locator("#refresh-settings").click();
  await page
    .getByRole("button", { name: "▱ Compare & Tune", exact: true })
    .click();
  await expect(page.locator('[data-printer="0"] option')).toHaveCount(2);
  await expect(page.locator('[data-preset="0:process"]')).toHaveValue(
    "process",
  );
  const nonExtractable = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("speed-printer-trust", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const key = await new Promise<CryptoKey>((resolve) => {
      const r = db
        .transaction("identity")
        .objectStore("identity")
        .get("browser");
      r.onsuccess = () => resolve(r.result.privateKey);
    });
    try {
      await crypto.subtle.exportKey("jwk", key);
      return false;
    } catch {
      return !key.extractable;
    } finally {
      db.close();
    }
  });
  expect(nonExtractable).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  const liveInput = page.locator("#number-outer_wall_speed");
  await liveInput.fill("215");
  // Same refresh handler as the background timer, without taking input focus.
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>("#refresh-library")!.click(),
  );
  await expect(page.locator("#toast")).toContainText(
    "Refreshed from OrcaSlicer",
  );
  await expect(liveInput).toBeFocused();
  await expect(liveInput).toHaveValue("215");
  await page.locator("#save").click();
  await page.locator("#confirm-save").click();
  source.process.__sp_hash = "version-two";
  source.process.outer_wall_speed = "123";
  await page.locator("#refresh-library").click();
  await expect(page.locator(".col-0 .source-warning")).toContainText(
    "source changed",
  );
  await page
    .getByRole("button", { name: "♧ Saved Presets", exact: true })
    .click();
  await expect(page.locator(".saved-card")).toContainText("source changed");
  token = ""; // Actual helper restart forgets only short-lived sessions.
  await page.reload();
  await expect(page.locator("#connection-state")).toHaveText(
    "Local helper connected",
  );
  await expect(page.locator('[data-printer="0"] option')).toHaveCount(2);
  expect(pairs).toBe(1);
  await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
  await page.locator("#revoke").click();
  await expect(page.locator("#pair-status")).toContainText("revoked");
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("revoked");
  expect(pairs).toBe(1);
});
