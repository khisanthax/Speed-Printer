export type Value = string | number | boolean | string[];
export type Profile = Record<string, Value> & { name: string; type: string };
export type Bundle = { machine: Profile; process: Profile; filament: Profile };
export type Summary = {
  seconds: number;
  grams?: number;
  meters?: number;
  source: string;
  modelHash: string;
  settingsHash: string;
  breakdown?: Record<string, number>;
};
export const settings = [
  ["outer_wall_speed", "Outer wall speed", "mm/s", "process", 1, 600],
  ["inner_wall_speed", "Inner wall speed", "mm/s", "process", 1, 800],
  ["sparse_infill_speed", "Infill speed", "mm/s", "process", 1, 1000],
  ["travel_speed", "Travel speed", "mm/s", "process", 1, 1200],
  ["default_acceleration", "Acceleration", "mm/s²", "process", 0, 30000],
  [
    "filament_max_volumetric_speed",
    "Max volumetric flow",
    "mm³/s",
    "filament",
    1,
    60,
  ],
  ["layer_height", "Layer height", "mm", "process", 0.05, 0.4],
  ["line_width", "Line width", "mm", "process", 0.2, 0.8],
  ["enable_support", "Supports", "", "process", 0, 1],
  ["fan_max_speed", "Cooling (part fan)", "%", "filament", 0, 100],
  ["slow_down_layer_time", "Minimum layer time", "s", "filament", 0, 60],
  ["sparse_infill_density", "Sparse infill density", "%", "process", 0, 100],
  ["bridge_speed", "Bridge speed", "mm/s", "process", 1, 300],
  ["initial_layer_speed", "First layer speed", "mm/s", "process", 1, 150],
  ["top_surface_speed", "Top surface speed", "mm/s", "process", 1, 400],
  ["wall_loops", "Wall loops", "", "process", 1, 10],
] as const;
export function resolve(
  name: string,
  profiles: Profile[],
  stack: string[] = [],
  kind?: string,
  scope?: Value,
): Profile {
  const identity = `${kind || ""}:${scope || ""}:${name}`;
  if (stack.includes(identity))
    throw new Error(`Preset inheritance cycle: ${name}`);
  let matches = profiles.filter(
    (p) => p.name === name && (!kind || p.type === kind),
  );
  if (!matches.length)
    matches = profiles.filter(
      (p) =>
        (Array.isArray(p.renamed_from)
          ? p.renamed_from
          : [p.renamed_from]
        ).includes(name) &&
        (!kind || p.type === kind),
    );
  const local = matches.filter((p) => scope && p.__sp_scope === scope);
  if (local.length) matches = local;
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Ambiguous preset: ${name}`
        : `Missing parent preset: ${name}. Import its parent or connect the helper.`,
    );
  const p = matches[0];
  if (p.inherits && typeof p.inherits !== "string")
    throw new Error("Only named single-parent Orca presets are supported.");
  const next = [...stack, identity];
  let parent = p.inherits
    ? resolve(String(p.inherits), profiles, next, p.type, p.__sp_scope)
    : {};
  const includes = p.include || p.includes || [];
  for (const item of Array.isArray(includes) ? includes : [String(includes)])
    parent = {
      ...parent,
      ...resolve(item, profiles, next, p.type, p.__sp_scope),
    };
  return { ...parent, ...p };
}
export function parseProfiles(raw: unknown): Profile[] {
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((p) => {
    if (
      !p ||
      typeof p !== "object" ||
      typeof p.name !== "string" ||
      !["machine", "process", "filament"].includes(p.type)
    )
      throw new Error(
        "Expected Orca JSON presets with name and type (machine, process, filament).",
      );
    if (
      Object.keys(p).some((k) =>
        ["__proto__", "constructor", "prototype"].includes(k),
      )
    )
      throw new Error("Unsafe preset key.");
    return p as Profile;
  });
}
export function numeric(
  bundle: Bundle,
  s: (typeof settings)[number],
): number | null {
  const v = bundle[s[3]][s[0]];
  if (v === undefined) return null;
  const text = String(Array.isArray(v) ? (v[0] ?? "") : v).trim();
  if (!text || (text.endsWith("%") && s[2] !== "%")) return null;
  const n = Number(text.replace("%", ""));
  return Number.isFinite(n) ? n : null;
}
export function changed(bundle: Bundle, key: string, n: number): Bundle {
  const s = settings.find((s) => s[0] === key);
  if (!s || !Number.isFinite(n) || n < s[4] || n > s[5])
    throw new Error("Value outside supported tuning range.");
  if (["enable_support", "wall_loops"].includes(key) && !Number.isInteger(n))
    throw new Error("This setting requires a whole number.");
  const old = bundle[s[3]][key];
  const value =
    key === "sparse_infill_density"
      ? `${n}%`
      : Array.isArray(old)
        ? [String(n), ...old.slice(1)]
        : String(n);
  return { ...bundle, [s[3]]: { ...bundle[s[3]], [key]: value } };
}
export function display(bundle: Bundle, s: (typeof settings)[number]) {
  const v = bundle[s[3]][s[0]];
  const text = String(Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
  if (text.endsWith("%") && s[2] !== "%") return `${text} (relative)`;
  const n = numeric(bundle, s);
  if (n === null) return "Not provided";
  if (s[0] === "default_acceleration" && n === 0)
    return "Firmware controlled (0)";
  if (s[0] === "enable_support") return n ? "Enabled" : "Disabled";
  return `${n.toLocaleString()} ${s[2]}`;
}
export function differs(a: Bundle, b: Bundle, s: (typeof settings)[number]) {
  return JSON.stringify(a[s[3]][s[0]]) !== JSON.stringify(b[s[3]][s[0]]);
}
export function duration(seconds: number | undefined) {
  if (seconds === undefined) return "—";
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function demoBundle(target = false): Bundle {
  return {
    machine: {
      name: target ? "SV08" : "Mercury One",
      type: "machine",
      printer_model: target ? "SV08" : "Mercury One",
      nozzle_diameter: ["0.4"],
    },
    process: {
      name: "Production (0.20 mm) · DEMO",
      type: "process",
      outer_wall_speed: target ? "300" : "200",
      inner_wall_speed: target ? "450" : "300",
      sparse_infill_speed: target ? "500" : "350",
      travel_speed: target ? "800" : "500",
      default_acceleration: target ? "20000" : "0",
      layer_height: "0.2",
      line_width: "0.4",
      enable_support: "1",
      sparse_infill_density: "15%",
      bridge_speed: "50",
      initial_layer_speed: "50",
      top_surface_speed: "150",
      wall_loops: "2",
    },
    filament: {
      name: "Generic PLA · DEMO",
      type: "filament",
      filament_max_volumetric_speed: [target ? "32" : "24"],
      fan_max_speed: ["100"],
      slow_down_layer_time: [target ? "5" : "8"],
    },
  };
}
