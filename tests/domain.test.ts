import { describe, expect, it } from "vitest";
import {
  changed,
  demoBundle,
  numeric,
  parseProfiles,
  resolve,
  settings,
} from "../src/domain";
describe("Orca inheritance and tuning", () => {
  it("resolves multi-generation inheritance without replacing inherited arrays", () => {
    const p = parseProfiles([
      {
        name: "base",
        type: "process",
        outer_wall_speed: "100",
        custom: ["a", "b"],
      },
      {
        name: "child",
        type: "process",
        inherits: "base",
        inner_wall_speed: "200",
      },
      {
        name: "leaf",
        type: "process",
        inherits: "child",
        outer_wall_speed: "150",
      },
    ]);
    expect(resolve("leaf", p)).toMatchObject({
      outer_wall_speed: "150",
      inner_wall_speed: "200",
      custom: ["a", "b"],
    });
  });
  it("blocks cycles, missing parents and ambiguous names", () => {
    expect(() =>
      resolve(
        "a",
        parseProfiles([
          { name: "a", type: "process", inherits: "b" },
          { name: "b", type: "process", inherits: "a" },
        ]),
      ),
    ).toThrow("cycle");
    expect(() => resolve("missing", [])).toThrow("Missing");
    expect(() =>
      resolve(
        "a",
        parseProfiles([
          { name: "a", type: "process" },
          { name: "a", type: "machine" },
        ]),
      ),
    ).toThrow("Ambiguous");
  });
  it("preserves filament arrays and percentage serialization", () => {
    const b = changed(
      changed(demoBundle(), "filament_max_volumetric_speed", 30),
      "sparse_infill_density",
      20,
    );
    expect(b.filament.filament_max_volumetric_speed).toEqual(["30"]);
    expect(b.process.sparse_infill_density).toBe("20%");
    b.filament.filament_max_volumetric_speed=['30','15'];
    expect(changed(b,'filament_max_volumetric_speed',32).filament.filament_max_volumetric_speed).toEqual(['32','15']);
  });
  it("recognizes zero acceleration and missing settings without invented defaults", () => {
    const b = demoBundle();
    delete b.process.layer_height;
    expect(numeric(b, settings[4])).toBe(0);
    expect(numeric(b, settings[6])).toBeNull();
    expect(() => changed(b, "layer_height", 0)).toThrow();
    expect(() => changed(b, "travel_speed", NaN)).toThrow();
    expect(()=>changed(b,'enable_support',.5)).toThrow();
  });
});
