import { expect, test } from "vitest";
import { demoBundle } from "../src/domain";
import { sourceStatus, bundleFor, type Library } from "../src/library";
test("source changes and deletion preserve experiment snapshots", () => {
  const saved = demoBundle();
  saved.process.__sp_id = "process";
  saved.process.__sp_hash = "old";
  const original = JSON.stringify(saved);
  const library: Library = {
    imported: true,
    printers: [],
    profiles: [{ ...saved.process, __sp_hash: "new" }],
  };
  expect(sourceStatus(saved, library)).toContain("source changed");
  library.profiles = [];
  expect(sourceStatus(saved, library)).toContain("missing / renamed");
  expect(JSON.stringify(saved)).toBe(original);
});
test("missing saved selection never guesses an arbitrary profile", () => {
  const b = demoBundle();
  b.machine.__sp_id = "printer";
  const printer = {
    id: "printer",
    name: "Fixture",
    source: "User",
    current: true,
    remembered: true,
    process: [],
    filament: [],
    selected: { process: "missing", filament: "missing" },
  };
  expect(
    bundleFor(
      { imported: true, printers: [printer], profiles: Object.values(b) },
      printer,
    ),
  ).toBeUndefined();
});
