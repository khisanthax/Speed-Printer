import { expect, it } from "vitest";
import { compareCohort } from "../src/lab";
it("requires explicit equivalence and two completed printer cohorts", () => {
  const rows = [
    {
      printer: "A",
      job: {
        filename: "same.gcode",
        status: "completed",
        print_duration: 100,
        metadata: { estimated_time: 90 },
      },
    },
    {
      printer: "B",
      job: {
        filename: "other.gcode",
        status: "completed",
        print_duration: 120,
      },
    },
    {
      printer: "B",
      job: { filename: "same.gcode", status: "cancelled", print_duration: 20 },
    },
  ];
  expect(() => compareCohort(rows, "", "PLA")).toThrow();
  const result = compareCohort(
    rows,
    "verified model hash",
    "PLA, 0.4 nozzle, 0.2 layer, same scale/overrides",
  );
  expect(result[1]).toMatchObject({
    count: 1,
    meanPrintSeconds: 120,
    estimateCount: 0,
    meanEstimateSeconds: undefined,
  });
  expect(result[0].meanEstimateSeconds).toBe(90);
  expect(() => compareCohort(rows.slice(1), "model", "conditions")).toThrow();
});
