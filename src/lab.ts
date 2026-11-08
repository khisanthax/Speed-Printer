export type HistoryJob = {
  filename: string;
  status: string;
  print_duration?: number;
  total_duration?: number;
  filament_used?: number;
  metadata?: Record<string, unknown>;
};
export function compareCohort(
  rows: { printer: string; job: HistoryJob }[],
  model: string,
  conditions: string,
) {
  if (!model.trim() || !conditions.trim())
    throw new Error(
      "Confirm an equivalent model identity and conditions before comparing selected jobs.",
    );
  const completed = rows.filter(
    (r) =>
      r.job.status === "completed" &&
      r.job.print_duration !== undefined &&
      r.job.print_duration > 0,
  );
  const printers = [...new Set(completed.map((r) => r.printer))];
  if (printers.length < 2)
    throw new Error(
      "Select completed jobs from at least two printers to compare.",
    );
  return printers.map((printer) => {
    const jobs = completed
      .filter((r) => r.printer === printer)
      .map((r) => r.job);
    const estimates = jobs.filter(
      (j) => Number(j.metadata?.estimated_time) > 0,
    );
    return {
      printer,
      count: jobs.length,
      meanPrintSeconds:
        jobs.reduce((s, j) => s + j.print_duration!, 0) / jobs.length,
      estimateCount: estimates.length,
      meanEstimateSeconds: estimates.length
        ? estimates.reduce(
            (s, j) => s + Number(j.metadata!.estimated_time),
            0,
          ) / estimates.length
        : undefined,
    };
  });
}
