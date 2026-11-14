import "./style.css";
import "./layout.css";
import { Helper } from "./api";
import { bundleFor, sourceStatus, type Library, type Printer } from "./library";
import { compareCohort } from "./lab";
import {
  changed,
  demoBundle,
  display,
  differs,
  duration,
  numeric,
  parseProfiles,
  resolve,
  settings,
  tuningStep,
  type Bundle,
  type Profile,
  type Summary,
} from "./domain";

const $ = <T extends Element = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const helper = new Helper();
helper.onStatus = (status) => {
  $("#connection-state").textContent = status;
  const field = document.querySelector("#pair-status");
  if (field) field.textContent = status;
};
let library: Library | undefined;
let restoredWorkspace = false;
let refreshBusy = false;
const rememberedPicks = new Map<
  string,
  { process: string; filament: string }
>();
let connected = false,
  model = "",
  modelName = "No common model selected",
  selected = 0,
  timer: ReturnType<typeof setTimeout>,
  syncing = false;
let sliceBusy = false;
const pendingSlices = new Set<number>();
const revisions = [0, 0, 0];
const completedSlices = new Map<string, Summary>();
let modelRevision = 0,
  tuningDue = 0;
let activeSlice: { column: number; key: string; revision: number } | undefined;
let sharedLayoutSupported = false;
let verifiedLayout: string | undefined, verifiedModelHash: string | undefined;
let bundles = [demoBundle(), demoBundle(true)],
  tuned = structuredClone(bundles[0]);
let importedProcesses: (Profile | undefined)[] = [];
let summaries: (Summary | undefined)[] = [undefined, undefined, undefined],
  states = ["Not sliced", "Not sliced", "Not sliced"];
let catalog: Profile[] = [],
  tunedDemo = true,
  isDemo = [true, true],
  view = "Compare & Tune";
type Preset = {
  demo: boolean;
  name: string;
  bundle: Bundle;
  summary?: Summary;
  created: string;
};
function presets(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem("speed-printer-presets") || "[]");
  } catch {
    return [];
  }
}
document.querySelector("#app")!.innerHTML = `
<header><div class="brand"><span class="cube">⬡</span> Speed Printer <span class="brand-sub">3D Printer Profile Tuner</span></div><span class="tagline">Compare • Tune • Match • Export</span><span class="compatible">✓ OrcaSlicer Compatible</span><button id="help" aria-label="Setup help">?</button></header>
<aside><nav>${["Compare & Tune", "Saved Presets", "Print Lab", "Settings"].map((v, i) => `<button data-nav="${v}" class="${i === 0 ? "active" : ""}"><span>${["▱", "♧", "♙", "⚙"][i]}</span>${v}</button>`).join("")}</nav><button id="connection" class="connection"><span>◈</span><div>OrcaSlicer<small id="connection-state">Helper disconnected</small></div><i id="connection-dot"></i></button></aside>
<main><div class="page-heading"><div><h1>3D Printer Profile Comparison & Tuning</h1><p>Compare two printers, tune your profile, and install directly into OrcaSlicer.</p></div><div class="model-actions"><button id="choose-model" class="primary">Select Model &amp; Slice All</button><button id="slice-all" hidden>Slice All</button></div></div><div class="workspace-status"><span id="model-name">${modelName}</span><span id="notice">Demo profiles · import your profiles to begin a verified comparison.</span></div><section id="compare" class="columns"></section><section id="other" hidden></section></main>
<dialog id="modal"><form method="dialog"><button class="close" aria-label="Close dialog">×</button></form><div id="modal-content"></div></dialog><div id="toast" role="status" aria-live="polite"></div><input type="file" id="file" multiple accept=".json" hidden>`;
function notify(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 7000);
}
const conditionsButton = document.createElement("button");
conditionsButton.textContent = "Compare conditions";
$(".workspace-status").append(conditionsButton);
conditionsButton.onclick = conditionsDialog;
function conditionsDialog() {
  const important = [
    "enable_support",
    "wall_loops",
    "layer_height",
    "filament_max_volumetric_speed",
    "slow_down_layer_time",
    "default_acceleration",
  ];
  const conditions = important
    .map((key) => {
      const setting = settings.find((s) => s[0] === key)!;
      return `<tr><td>${setting[1]}</td>${bundles.map((b) => `<td>${escape(display(b, setting))}</td>`).join("")}</tr>`;
    })
    .join("");
  const differences = (["machine", "process", "filament"] as const).flatMap(
    (kind) =>
      [
        ...new Set([
          ...Object.keys(bundles[0][kind]),
          ...Object.keys(bundles[1][kind]),
        ]),
      ]
        .filter(
          (key) =>
            !key.startsWith("__") &&
            JSON.stringify(bundles[0][kind][key]) !==
              JSON.stringify(bundles[1][kind][key]),
        )
        .sort()
        .map(
          (key) =>
            `<tr><td>${kind} · ${escape(key)}</td><td>${escape(JSON.stringify(bundles[0][kind][key]) ?? "Not provided")}</td><td>${escape(JSON.stringify(bundles[1][kind][key]) ?? "Not provided")}</td></tr>`,
        ),
  );
  modal(
    `<h2>Comparison conditions</h2><table><thead><tr><th>Condition</th><th>A</th><th>B</th></tr></thead><tbody>${conditions}</tbody></table><p>Saved profiles compare complete recipes, including supports, quality, cooling, flow limits and machine constraints. The difference in total time cannot be attributed to printer speed alone.</p><p>Common-process mode uses A’s entire process on both printers, retaining each machine and calibrated filament. Filament and machine differences still matter. All printable project instances are arranged once on one common plate within the shared rectangular bed area. Meshes, copies, placement and object overrides then remain fixed for A, B and C. Embedded object settings can override a profile setting.</p><div class="actions"><button id="common-process">Use A’s process on both</button><button id="restore-process">Restore imported processes</button></div><table><thead><tr><th>Effective setting</th><th>A</th><th>B</th></tr></thead><tbody>${differences.join("")}</tbody></table>`,
  );
  const apply = () => {
    summaries = [undefined, undefined, undefined];
    states = ["Not sliced", "Not sliced", "Not sliced"];
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    clearTimeout(timer);
    tuningDue = 0;
    revisions.forEach((_, i) => revisions[i]++);
    $<HTMLDialogElement>("#modal").close();
    renderCompare();
    if (model && connected) sliceAll();
  };
  $("#common-process").onclick = () => {
    if (isDemo.some(Boolean)) {
      notify("Import both real profiles first.");
      return;
    }
    bundles[1].process = structuredClone(bundles[0].process);
    bundles[1].process.compatible_printers = [bundles[1].machine.name];
    $("#notice").textContent =
      "Common process from A · each printer retains its calibrated filament and machine limits. Re-slice both.";
    apply();
  };
  $("#restore-process").onclick = () => {
    importedProcesses.forEach((p, i) => {
      if (p) bundles[i].process = structuredClone(p);
    });
    $("#notice").textContent =
      "Imported processes restored · compare saved recipes or analyze controlled substitutions.";
    apply();
  };
}
function modal(html: string) {
  $("#modal-content").innerHTML = html;
  $<HTMLDialogElement>("#modal").showModal();
}
function requireHelper() {
  if (!connected) {
    navigate("Settings");
    notify("Start the local helper and pair it in Settings.");
    return false;
  }
  return true;
}
function profileInfo(i: number) {
  const b = i === 2 ? tuned : bundles[i];
  if (i < 2 && library?.printers?.length && b.machine.__sp_id) {
    const p = library.printers.find((p) => p.id === b.machine.__sp_id);
    const available = (kind: "process" | "filament") =>
      (p?.[kind] || []).filter((c) => {
        if (kind !== "filament") return true;
        const material = library!.profiles.find((q) => q.__sp_id === c.id)!;
        const prints = material.compatible_prints;
        return (
          !Array.isArray(prints) ||
          !prints.length ||
          prints.includes(b.process.name)
        );
      });
    const choices = (kind: "process" | "filament") =>
      `<label>${kind === "process" ? "Process" : "Filament"}<select data-preset="${i}:${kind}" aria-label="${i === 0 ? "A" : "B"} ${kind}"><option value="">Select ${kind}</option>${!available(kind).some((c) => c.id === b[kind].__sp_id) && b[kind].__sp_id ? `<option selected value="${escape(b[kind].__sp_id)}">${escape(b[kind].name)} · snapshot / source missing or incompatible</option>` : ""}${available(
        kind,
      )
        .map(
          (c) =>
            `<option value="${c.id}" ${c.id === b[kind].__sp_id ? "selected" : ""}>${escape(c.name)} · ${escape(c.source)}${c.compatibility !== "matched" ? " · " + escape(c.compatibility) : ""}</option>`,
        )
        .join("")}</select></label>`;
    return `<section class="profile section"><div class="printer-shot ${b.machine.name.toLowerCase().includes("sv08") ? "sv08" : ""}" role="img" aria-label="Printer reference image"></div><div class="profile-info curated"><label>Printer<select data-printer="${i}" aria-label="${i === 0 ? "A" : "B"} printer"><option value="">Select printer</option>${!p && b.machine.__sp_id ? `<option selected value="${escape(b.machine.__sp_id)}">${escape(b.machine.name)} · retained snapshot</option>` : ""}${library.printers.map((p) => `<option value="${p.id}" ${p.id === b.machine.__sp_id ? "selected" : ""}>${escape(p.name)} · ${p.source === "User" ? "User" : "Enabled system"}${p.current ? " · Current" : p.remembered ? " · Remembered" : ""}</option>`).join("")}</select></label>${choices("process")}${choices("filament")}<small class="source-warning">${escape(sourceStatus(b, library))}</small><button class="small" data-import="${i}">Import / Advanced</button></div></section>`;
  }
  return `<section class="profile section"><div class="printer-shot ${b.machine.name.toLowerCase().includes("sv08") ? "sv08" : ""}" role="img" aria-label="Approved ${b.machine.name.toLowerCase().includes("sv08") ? "SV08" : "Mercury One"} reference image"></div><div class="profile-info">${i === 2 ? `<label for="modify">Profile to change</label><select id="modify"><option value="0" ${selected === 0 ? "selected" : ""}>${escape(bundles[0].machine.name)}</option><option value="1" ${selected === 1 ? "selected" : ""}>${escape(bundles[1].machine.name)}</option></select><span class="target">◎ Target: ${escape(bundles[1 - selected].machine.name)}</span>` : `<h2>${escape(b.machine.name)}</h2><span class="chip">${isDemo[i] ? "CoreXY · DEMO" : "Imported profile"}</span><dl><dt>Nozzle</dt><dd>${escape(b.machine.nozzle_diameter || "Not provided")} mm</dd><dt>Process</dt><dd>${escape(b.process.name)}</dd><dt>Filament</dt><dd>${escape(b.filament.name)}</dd></dl><button class="small" data-import="${i}">Import profiles</button>`}</div></section>`;
}
function rows(i: number) {
  const b = i === 2 ? tuned : bundles[i];
  return settings
    .map((s) => {
      const n = numeric(b, s),
        diff = differs(bundles[0], bundles[1], s);
      const controls =
        s[0] === "enable_support"
          ? `<input id="number-enable_support" aria-label="Supports enabled" type="checkbox" data-key="enable_support" ${n ? "checked" : ""} ${n === null ? "disabled" : ""}><span>Enable supports</span>`
          : `<button class="nudge" data-adjust="${s[0]}:-1" aria-label="Decrease ${s[1]}" ${n === null || n <= s[4] ? "disabled" : ""}>−</button><input aria-label="${s[1]} slider" type="range" data-key="${s[0]}" min="${s[4]}" max="${s[5]}" step="${tuningStep(s)}" value="${n ?? s[4]}" ${n === null ? "disabled" : ""}><button class="nudge" data-adjust="${s[0]}:1" aria-label="Increase ${s[1]}" ${n === null || n >= s[5] ? "disabled" : ""}>+</button><input id="number-${s[0]}" aria-label="${s[1]} value" type="number" data-key="${s[0]}" min="${s[4]}" max="${s[5]}" step="${tuningStep(s)}" value="${n ?? ""}" ${n === null ? "disabled" : ""}><span class="unit">${s[2]}</span>`;
      return `<div class="setting-row ${diff ? "diff" : ""}"><span class="setting-icon">${s[3] === "filament" ? "♧" : "ϟ"}</span><label ${i === 2 ? `for="number-${s[0]}"` : ""} title="${s[0]}">${s[1]}${s[0] === "default_acceleration" ? '<small title="Zero delegates acceleration to firmware where supported; verify Klipper and slicer machine limits."> ⓘ</small>' : ""}</label>${i === 2 ? controls : `<strong>${escape(display(b, s))}</strong>`}</div>`;
    })
    .join("");
}
function summary(i: number) {
  const s = summaries[i];
  const b = summaries[1 - selected];
  const pct =
    s &&
    b &&
    states[i].startsWith("Verified") &&
    states[1 - selected].startsWith("Verified") &&
    s.modelHash === b.modelHash &&
    s.layoutHash === b.layoutHash
      ? (s.seconds / b.seconds - 1) * 100
      : undefined;
  return `<div class="section-title"><h2><span>▥</span> ${i === 2 ? "Live Summary" : "Summary"}</h2>${i === 2 ? `<div><button class="small" id="export-project">Export 3MF</button>${s?.notes?.length ? `<button class="small" data-result-details="2">Scope</button>` : ""}</div>` : `<span class="chip">${states[i].startsWith("Verified") ? "OrcaSlicer result" : s ? "Stale estimate" : "Awaiting slice"}</span>`}</div><div class="time-metric"><span>◷ &nbsp; Estimated print time</span><div class="time-value"><strong>${duration(s?.seconds)}</strong>${s ? `<small>${s.seconds.toLocaleString()} s · exact engine estimate</small>` : ""}</div></div><div class="metric"><span>▤ &nbsp; Filament used</span><strong>${s?.grams === undefined ? "Not provided" : s.grams.toFixed(2) + " g"}</strong><small>${s?.meters === undefined ? "" : s.meters.toFixed(2) + " m"}</small></div><div class="metric"><span>♧ &nbsp; Support material</span><strong>Not separately provided</strong></div><div class="metric"><span>⌁ &nbsp; Travel / feature breakdown</span><strong>Not provided by engine</strong></div><div class="result-status ${!states[i].startsWith("Verified") && s ? "stale" : ""}" role="status" aria-live="polite">${/recalculating|Slicing|Queued/.test(states[i]) ? `<progress aria-label="${i === 2 ? "Live tuning" : "Printer " + (i === 0 ? "A" : "B")} slicing progress"></progress>` : ""}${escape(states[i])}${pct === undefined ? "" : ` · ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% vs target`}</div>${i === 2 ? `<div class="safety">Faster estimates do not establish safe hardware limits.</div><div class="actions"><button id="reset">↶ Reset</button><button id="save">♧ Save Preset</button><button id="install" class="primary">♙ Install in OrcaSlicer</button></div>` : `<small class="source">${s ? escape(s.source) + (s.objectCount ? ` · ${s.objectCount} objects` : "") + (s.notes?.length ? `<button class="small" data-result-details="${i}">Scope & limits</button>` : "") : "Real estimates appear after local slicing completes."}</small>`}`;
}
function bindResultDetails() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-result-details]")
    .forEach((el) => {
      el.onclick = () => {
        const result = summaries[Number(el.dataset.resultDetails)];
        if (!result) return;
        modal(
          `<h2>Last verified slice: scope and limits</h2><p>${result.seconds.toLocaleString()} seconds · ${escape(result.source)}${result.objectCount ? ` · ${result.objectCount} objects` : ""}. A stale summary remains the last completed result until re-slicing finishes.</p>${result.notes?.map((note) => `<p>${escape(note)}</p>`).join("") || ""}`,
        );
      };
    });
}
function renderCompare() {
  const scroll = $<HTMLElement>(".settings-scroll")?.scrollTop || 0;
  $("#compare").innerHTML = [0, 1, 2]
    .map(
      (i) =>
        `<article class="column col-${i}"><div class="column-heading"><span>${i === 2 ? "☷" : "♙"}</span><div><h2>${["A — Current Printer", "B — Target Printer", "C — Live Tuning"][i]}</h2>${i === 2 ? `<small>Tune ${escape(bundles[selected].machine.name)} to match ${escape(bundles[1 - selected].machine.name)}</small>` : ""}</div></div>${profileInfo(i)}<section class="settings section"><div class="section-title"><h2><span>⚙</span> ${i === 2 ? "Live Adjustment Controls" : "Profile Settings"}</h2>${i === 2 ? '<button id="analyze" class="small">ϟ Analyze impact</button>' : `<span class="chip">${escape(bundles[i].process.layer_height || "—")} mm</span>`}</div><div class="settings-banner">ϟ ${i === 2 ? "Scroll linked across columns (synced scroll)" : "Speed-Affecting Settings (OrcaSlicer)"}<small>${i === 2 ? "Automatic local re-slicing" : "ⓘ Scroll linked across columns"}</small></div><div class="settings-scroll">${rows(i)}</div><div class="settings-foot">${i === 2 ? "Acceleration 0: firmware controlled where supported." : "Highlighted rows differ between profiles."}</div></section><section class="summary section" id="summary-${i}">${summary(i)}</section></article>`,
    )
    .join("");
  document.querySelectorAll<HTMLSelectElement>("[data-printer]").forEach(
    (el) =>
      (el.onchange = () => {
        const i = Number(el.dataset.printer);
        const printer = library!.printers.find((p) => p.id === el.value);
        if (!printer) return;
        const bundle = bundleFor(
          library!,
          printer,
          rememberedPicks.get(printer.id) || printer.selected,
        );
        if (bundle) useBundle(i, bundle);
        else {
          const machine = library!.profiles.find(
            (p) => p.__sp_id === printer.id,
          )!;
          bundles[i] = {
            machine: structuredClone(machine),
            process: { name: "Select saved process", type: "process" },
            filament: { name: "Select saved filament", type: "filament" },
          };
          isDemo[i] = true;
          summaries[i] = undefined;
          states[i] = "Choose process and filament";
          renderCompare();
          notify(
            "No complete saved combination. Select a compatible process and filament.",
          );
        }
      }),
  );
  document.querySelectorAll<HTMLSelectElement>("[data-preset]").forEach(
    (el) =>
      (el.onchange = () => {
        const [index, kind] = el.dataset.preset!.split(":");
        const i = Number(index);
        const profile = library!.profiles.find((p) => p.__sp_id === el.value);
        if (!profile) return;
        const bundle = structuredClone(bundles[i]);
        bundle[kind as "process" | "filament"] = structuredClone(profile);
        useBundle(
          i,
          bundle,
          !bundle.process.__sp_id || !bundle.filament.__sp_id,
        );
      }),
  );
  document.querySelectorAll<HTMLElement>(".settings-scroll").forEach((el) => {
    el.scrollTop = scroll;
    el.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      document
        .querySelectorAll<HTMLElement>(".settings-scroll")
        .forEach((other) => {
          if (other !== el) other.scrollTop = el.scrollTop;
        });
      requestAnimationFrame(() => (syncing = false));
    });
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-import]")
    .forEach(
      (el) => (el.onclick = () => importDialog(Number(el.dataset.import))),
    );
  $("#modify").onchange = () => {
    selected = Number($<HTMLSelectElement>("#modify").value);
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    summaries[2] = undefined;
    states[2] = "Not sliced";
    revisions[2]++;
    clearTimeout(timer);
    tuningDue = 0;
    renderCompare();
    if (model && connected && !tunedDemo) slice(2);
  };
  document.querySelectorAll<HTMLInputElement>("[data-key]").forEach((el) => {
    el.oninput = () => {
      if (el.type === "number" && !el.value.trim()) return;
      applyTuning(
        el.dataset.key!,
        el.type === "checkbox" ? Number(el.checked) : Number(el.value),
      );
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-adjust]").forEach(
    (button) =>
      (button.onclick = () => {
        const [key, direction] = button.dataset.adjust!.split(":");
        const setting = settings.find((s) => s[0] === key)!;
        const value = numeric(tuned, setting);
        if (value === null) return;
        const next = Math.max(
          setting[4],
          Math.min(
            setting[5],
            Number(
              (value + Number(direction) * tuningStep(setting)).toFixed(4),
            ),
          ),
        );
        applyTuning(key, next);
      }),
  );
  $("#reset").onclick = () => {
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    summaries[2] = undefined;
    states[2] = "Not sliced";
    revisions[2]++;
    clearTimeout(timer);
    tuningDue = 0;
    renderCompare();
    if (model && connected && !tunedDemo) slice(2);
  };
  $("#export-project").onclick = () => void exportProject();
  bindResultDetails();
  $("#save").onclick = savePreset;
  $("#install").onclick = () => void install();
  $("#analyze").onclick = analysisDialog;
  bindResultDetails();
}
function updateSummaries() {
  [0, 1, 2].forEach((i) => {
    $(`#summary-${i}`).innerHTML = summary(i);
  });
  $("#reset").onclick = () => {
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    summaries[2] = undefined;
    states[2] = "Not sliced";
    revisions[2]++;
    clearTimeout(timer);
    tuningDue = 0;
    renderCompare();
    if (model && connected && !tunedDemo) slice(2);
  };
  $("#export-project").onclick = () => void exportProject();
  bindResultDetails();
  $("#save").onclick = savePreset;
  $("#install").onclick = () => void install();
}
async function waitJob(id: string) {
  for (let i = 0; i < 3600; i++) {
    const j = await helper.job(id);
    if (j.state === "complete") return j.result!;
    if (j.state === "failed" || j.state === "missing")
      throw new Error(j.error || "Local job no longer exists");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Job polling timed out. Check the local helper.");
}
function requestKey(bundle: Bundle) {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sorted(v)]),
          )
        : value;
  return modelRevision + ":" + model + ":" + JSON.stringify(sorted(bundle));
}
function applyTuning(key: string, value: number) {
  const setting = settings.find((s) => s[0] === key)!;
  try {
    tuned = changed(tuned, key, value);
  } catch (e) {
    const input = $<HTMLInputElement>(`#number-${key}`);
    if (input) input.value = String(numeric(tuned, setting) ?? "");
    notify(String(e));
    return;
  }
  revisions[2]++;
  document
    .querySelectorAll<HTMLInputElement>(`[data-key="${key}"]`)
    .forEach((input) => {
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(value);
    });
  document
    .querySelectorAll<HTMLButtonElement>(`[data-adjust^="${key}:"]`)
    .forEach((button) => {
      button.disabled = button.dataset.adjust!.endsWith(":-1")
        ? value <= setting[4]
        : value >= setting[5];
    });
  clearTimeout(timer);
  tuningDue = Date.now() + 650;
  states[2] = !model
    ? "Model required — select a model to recalculate"
    : !connected
      ? "Helper disconnected — reconnect to recalculate"
      : "Stale — recalculating" +
        (sliceBusy ? " · latest changes queued" : " · waiting for adjustments");
  updateSummaries();
  timer = setTimeout(() => {
    if (connected && model && !tunedDemo) slice(2);
    else if (tunedDemo && model) {
      states[2] = "Import complete real profiles to recalculate";
      updateSummaries();
    }
  }, 650);
}
function slice(i: number) {
  if (!model || !connected || (i === 2 ? tunedDemo : isDemo[i])) return;
  const key = requestKey(i === 2 ? tuned : bundles[i]);
  if (
    activeSlice?.column === i &&
    activeSlice.key === key &&
    activeSlice.revision === revisions[i]
  )
    return;
  pendingSlices.add(i);
  states[i] = summaries[i]
    ? "Stale — recalculating · queued"
    : "Queued · waiting for local OrcaSlicer";
  updateSummaries();
  void runNextSlice();
}
function sliceAll() {
  if (!requireHelper()) return;
  if (!model) {
    notify("Select the common model first.");
    return;
  }
  if (isDemo.some(Boolean) || tunedDemo) {
    notify("Select complete real profiles for A and B first.");
    return;
  }
  tuningDue = 0;
  clearTimeout(timer);
  // The same existing helper worker handles every request. C reuses A/B when identical.
  [0, 1, 2].forEach((i) => slice(i));
}
async function runNextSlice() {
  if (sliceBusy || !model || !connected) return;
  const i = [...pendingSlices].find((i) => i !== 2 || Date.now() >= tuningDue);
  if (i === undefined) return;
  pendingSlices.delete(i);
  if (i === 2 ? tunedDemo : isDemo[i]) {
    void runNextSlice();
    return;
  }
  const b = structuredClone(i === 2 ? tuned : bundles[i]);
  const revision = revisions[i],
    epoch = modelRevision,
    selectedModel = model,
    key = requestKey(b);
  const matchesCurrent = () =>
    model === selectedModel &&
    epoch === modelRevision &&
    revisions[i] === revision &&
    requestKey(i === 2 ? tuned : bundles[i]) === key;
  const accept = (result: Summary, reused = false) => {
    if (!matchesCurrent()) return;
    const previous = summaries[i];
    const delta =
      i === 2 &&
      previous?.modelHash === result.modelHash &&
      previous.layoutHash === result.layoutHash
        ? result.seconds - previous.seconds
        : undefined;
    const change =
      delta === undefined
        ? ""
        : delta === 0
          ? " · estimate unchanged for this model"
          : ` · ${Math.abs(delta).toLocaleString()} s ${delta < 0 ? "faster" : "slower"} than last C result`;
    summaries[i] = result;
    states[i] =
      "Verified local slice" +
      (reused ? " · identical source result reused" : "") +
      change +
      " · " +
      new Date().toLocaleTimeString();
    updateSummaries();
  };
  const cached = completedSlices.get(key);
  if (cached) {
    accept(cached, true);
    void runNextSlice();
    return;
  }
  sliceBusy = true;
  activeSlice = { column: i, key, revision };
  states[i] = summaries[i]
    ? "Stale — recalculating · local slice running"
    : "Slicing · local OrcaSlicer running";
  updateSummaries();
  try {
    const job = await helper.slice(b, selectedModel);
    const result = await waitJob(job.id);
    if (epoch === modelRevision) {
      if (
        !result.layoutHash ||
        (verifiedLayout && result.layoutHash !== verifiedLayout) ||
        (verifiedModelHash && result.modelHash !== verifiedModelHash)
      )
        throw new Error(
          "Common layout changed. Select the model again before comparing these results.",
        );
      verifiedLayout = result.layoutHash;
      verifiedModelHash = result.modelHash;
      if (completedSlices.size >= 128)
        completedSlices.delete(completedSlices.keys().next().value!);
      completedSlices.set(key, result);
    }
    accept(result);
  } catch (e) {
    if (matchesCurrent()) {
      summaries[i] = undefined;
      states[i] =
        "Slice failed — " +
        (e instanceof Error ? e.message : String(e)) +
        " Use Slice All to retry.";
      updateSummaries();
    }
  } finally {
    sliceBusy = false;
    activeSlice = undefined;
    void runNextSlice();
  }
}

function importDialog(i: number) {
  modal(
    `<h2>Import ${i === 0 ? "current" : "target"} profiles</h2><p>One local approval imports configured printers and compatible saved presets. Subsequent sessions restore this library automatically.</p><div class="actions"><button id="manual-import">Import JSON files</button><button id="local-import">Read local Orca profiles</button><button id="portable-import">Choose portable folder</button></div><details><summary>Advanced / Browse All Profiles</summary><p>Installed system catalog includes unconfigured printers and incompatible presets. Select deliberately; this view does not establish compatibility.</p><button id="browse-all">Load full installed catalog</button><p>${escape(library?.note || "")}</p></details><div id="selectors"></div>`,
  );
  const choose = () => {
    $("#selectors").innerHTML =
      `<div class="form-grid">${["machine", "process", "filament"].map((kind) => `<label>${kind}<select id="pick-${kind}"><option value="">Select ${kind}</option>${catalog.map((p, j) => (p.type === kind ? `<option value="${j}">${escape(p.name)}</option>` : "")).join("")}</select></label>`).join("")}</div><button class="primary" id="apply-import">Use selected profiles</button>`;
    $("#apply-import").onclick = () => {
      try {
        const bundle = {} as Bundle;
        for (const kind of ["machine", "process", "filament"] as const) {
          const v = $<HTMLSelectElement>(`#pick-${kind}`).value;
          if (v === "") throw new Error(`Select a ${kind} profile`);
          bundle[kind] = {
            ...resolve(
              catalog[Number(v)].name,
              catalog,
              [],
              kind,
              catalog[Number(v)].__sp_scope,
            ),
            inherits: "",
          };
        }
        revisions[i]++;
        if (i === selected) revisions[2]++;
        bundles[i] = bundle;
        importedProcesses[i] = structuredClone(bundle.process);
        isDemo[i] = false;
        summaries[i] = undefined;
        states[i] = "Not sliced";
        if (i === selected) {
          tuned = structuredClone(bundle);
          tunedDemo = false;
          summaries[2] = undefined;
          states[2] = "Not sliced";
        }
        $("#notice").textContent = isDemo.some(Boolean)
          ? "One demo profile remains · import both for comparison."
          : "Imported effective profiles · choose a common model for verified estimates.";
        $<HTMLDialogElement>("#modal").close();
        renderCompare();
        if (model && connected) {
          slice(i);
          if (i === selected) slice(2);
        }
      } catch (e) {
        notify(String(e));
      }
    };
  };
  $("#manual-import").onclick = () => {
    $<HTMLInputElement>("#file").onchange = async () => {
      try {
        for (const f of $<HTMLInputElement>("#file").files || []) {
          if (f.size > 2_000_000) throw new Error("JSON preset exceeds 2 MB");
          const imported = parseProfiles(JSON.parse(await f.text()));
          for (const p of imported) {
            catalog = catalog.filter(
              (c) => !(c.name === p.name && c.type === p.type),
            );
            catalog.push(p);
          }
        }
        choose();
      } catch (e) {
        notify(String(e));
      }
      $<HTMLInputElement>("#file").value = "";
    };
    $("#file").click();
  };
  const local = async (portable = false) => {
    if (!connected) {
      $<HTMLDialogElement>("#modal").close();
      navigate("Settings");
      return;
    }
    try {
      const result = await helper.call<Library>("/profiles", {
        chooseRoot: portable,
      });
      catalog = result.profiles;
      if (result.printers?.length) {
        acceptLibrary(result);
        $<HTMLDialogElement>("#modal").close();
        await restoreLibrary();
        renderCompare();
        return;
      }
      choose();
      if (result.warnings?.length)
        notify(result.warnings.slice(0, 3).join("; "));
    } catch (e) {
      notify(String(e));
    }
  };
  $("#local-import").onclick = () => void local();
  $("#portable-import").onclick = () => void local(true);
  $("#browse-all").onclick = async () => {
    if (!requireHelper()) return;
    try {
      const r = await helper.call<Library>("/profiles", { all: true });
      catalog = r.profiles;
      choose();
    } catch (e) {
      notify(String(e));
    }
  };
  if (catalog.length && !library?.imported) choose();
}
function useBundle(i: number, bundle: Bundle, incomplete = false) {
  revisions[i]++;
  if (i === selected) {
    revisions[2]++;
    tuningDue = 0;
  }
  bundles[i] = structuredClone(bundle);
  importedProcesses[i] = structuredClone(bundle.process);
  isDemo[i] = incomplete;
  summaries[i] = undefined;
  states[i] = incomplete ? "Choose process and filament" : "Not sliced";
  if (i === selected) {
    tuned = structuredClone(bundle);
    tunedDemo = incomplete;
    summaries[2] = undefined;
    states[2] = "Not sliced";
    clearTimeout(timer);
  }
  if (!incomplete) {
    rememberedPicks.set(String(bundle.machine.__sp_id), {
      process: String(bundle.process.__sp_id),
      filament: String(bundle.filament.__sp_id),
    });
    if (connected)
      void helper
        .call("/workspace", {
          ...(!isDemo[0] ? { a: bundles[0] } : {}),
          ...(!isDemo[1] ? { b: bundles[1] } : {}),
        })
        .catch((e) => notify(String(e)));
  }
  $("#notice").textContent =
    "Saved local profiles · select a common model for verified estimates.";
  renderCompare();
  if (model && connected && !incomplete) {
    slice(i);
    if (i === selected) slice(2);
  }
}
function acceptLibrary(result: Library) {
  if (!result.printers) return;
  library = result;
  catalog = result.profiles;
  if (result.warnings?.length) notify(result.warnings.slice(0, 3).join("; "));
}
async function restoreLibrary() {
  if (restoredWorkspace || !library?.imported) return;
  const saved = await helper.call<{ a?: Bundle; b?: Bundle }>("/workspace");
  restoredWorkspace = true;
  for (const [i, key] of ["a", "b"].entries()) {
    const snapshot = saved[key as "a" | "b"];
    const printer =
      i === 0
        ? library.printers.find((p) => p.current) || library.printers[0]
        : library.printers.find(
            (p) => p.name.toLowerCase().includes("sv08") && p.source === "User",
          ) ||
          library.printers.find((p) => p.id !== bundles[0].machine.__sp_id);
    const bundle = snapshot || (printer && bundleFor(library, printer));
    if (bundle) {
      bundles[i] = structuredClone(bundle);
      importedProcesses[i] = structuredClone(bundle.process);
      isDemo[i] = false;
    }
  }
  tuned = structuredClone(bundles[selected]);
  tunedDemo = isDemo[selected];
  $("#notice").textContent =
    "Cached Orca profiles restored · source changes retain original snapshots.";
  renderCompare();
}
async function refreshLibrary(announce = true) {
  if (refreshBusy || !connected) return;
  refreshBusy = true;
  try {
    const result = await helper.call<Library>("/profiles", {});
    const changed = JSON.stringify(library) !== JSON.stringify(result);
    acceptLibrary(result);
    await restoreLibrary();
    if (changed && !document.activeElement?.matches("[data-key],[data-adjust]"))
      renderCompare();
    if (announce)
      notify(
        "Refreshed from OrcaSlicer. Existing comparison and experiment snapshots retained; select a profile again to use changed settings.",
      );
  } catch (e) {
    if (announce) notify(String(e));
  } finally {
    refreshBusy = false;
  }
}
function savePreset() {
  modal(
    `<h2>Save reusable experiment</h2><p>Saved only in this browser. Exports may contain private profile data.</p><label>Name<input id="preset-name" value="Speed Printer experiment"></label><button id="confirm-save" class="primary">Save preset</button>`,
  );
  $("#confirm-save").onclick = () => {
    const name = $<HTMLInputElement>("#preset-name").value.trim();
    if (!name) return;
    const all = presets();
    all.push({
      demo: tunedDemo,
      name,
      bundle: structuredClone(tuned),
      summary: states[2].startsWith("Verified") ? summaries[2] : undefined,
      created: new Date().toISOString(),
    });
    try {
      localStorage.setItem("speed-printer-presets", JSON.stringify(all));
      $<HTMLDialogElement>("#modal").close();
      notify("Experiment saved in this browser.");
    } catch {
      notify(
        "Browser storage is full or unavailable. Export the profile instead.",
      );
    }
  };
}
async function exportProject() {
  if (!requireHelper()) return;
  if (!model || tunedDemo || !states[2].startsWith("Verified")) {
    notify("Verify the current tuned profile before exporting its project.");
    return;
  }
  try {
    const job = await helper.call<{ id: string }>("/export-project", {
      bundle: structuredClone(tuned),
      model,
    });
    notify(
      "Export queued. Orca will re-slice the exact comparison arrangement locally.",
    );
    const result = await waitJob(job.id);
    notify(
      `Verified project exported: ${result.exportedProject}. Open it in Orca to retain the comparison arrangement.`,
    );
  } catch (e) {
    notify(String(e));
  }
}
async function install() {
  if (!requireHelper()) return;
  if (!states[2].startsWith("Verified")) {
    notify("Slice the tuned profile successfully before installation.");
    return;
  }
  modal(
    `<h2>Install new Orca presets</h2><p>The helper will ask you to select the correct local account folder and confirm. After installing, open a new OrcaSlicer window to load the new presets. Keep any unsaved projects open.</p><label>New preset name<input id="install-name" value="Speed Printer tuned"></label><button id="confirm-install" class="primary">Continue to local confirmation</button>`,
  );
  $("#confirm-install").onclick = async () => {
    try {
      const installing = structuredClone(tuned);
      const result = await helper.call<{ installed: string[]; bundle: Bundle }>(
        "/install",
        {
          bundle: installing,
          name: $<HTMLInputElement>("#install-name").value,
        },
      );
      if (library?.imported) {
        // Installed files have new identities. Track those sources rather than
        // retaining the original printer's version tags on later experiments.
        const refreshed = await helper
          .call<Library>("/profiles", {})
          .catch(() => undefined);
        if (refreshed) acceptLibrary(refreshed);
        for (const kind of ["machine", "process", "filament"] as const) {
          const matches = (refreshed?.profiles || []).filter(
            (p) => p.type === kind && p.name === result.bundle[kind].name,
          );
          if (matches.length === 1) {
            result.bundle[kind].__sp_id = matches[0].__sp_id;
            result.bundle[kind].__sp_hash = matches[0].__sp_hash;
          }
        }
      }
      $<HTMLDialogElement>("#modal").close();
      if (JSON.stringify(tuned) === JSON.stringify(installing)) {
        tuned = result.bundle;
        revisions[2]++;
        tuningDue = 0;
        clearTimeout(timer);
        states[2] = "Stale · verifying installed preset names";
        renderCompare();
        void slice(2);
      }
      notify(
        "Three new presets installed. Verifying their named bundle; open a new Orca window to use them. Unsaved projects can stay open.",
      );
    } catch (e) {
      notify(String(e));
    }
  };
}
const motionExperiments = [
  ["xy_jerk_limits", "X/Y jerk limits · simulation only"],
  [
    "extruding_acceleration_limit",
    "Extruding acceleration cap · simulation only",
  ],
] as const;
function analysisDialog() {
  if (!requireHelper()) return;
  if (!model || isDemo.some(Boolean)) {
    notify("Import both profile bundles and choose a common model first.");
    return;
  }
  modal(
    `<h2>Controlled speed analysis</h2><p>Re-slice each setting toward the other printer, then re-slice the cumulative ranked combination. This measures model-specific effects and order-dependent interactions. Orca enforces profile constraints; hardware safety still requires validation.</p><div class="analysis-keys">${settings.map((s, i) => `<label><input type="checkbox" value="${s[0]}" ${i < 6 ? "checked" : ""}>${s[1]}${["layer_height", "line_width", "enable_support", "fan_max_speed", "slow_down_layer_time", "sparse_infill_density", "wall_loops"].includes(s[0]) ? " · changes quality / cooling" : ""}</label>`).join("")}${motionExperiments.map(([key, label]) => `<label><input type="checkbox" value="${key}">${label}</label>`).join("")}</div><p>Motion-limit experiments simulate target slicer limits without changing firmware. They cannot be applied or installed from this dialog; estimates do not prove safe hardware limits.</p><button id="run-analysis" class="primary">Run controlled re-slicing</button><div id="analysis-result" role="status"></div>`,
  );
  $("#run-analysis").onclick = async () => {
    const keys = [
      ...document.querySelectorAll<HTMLInputElement>(
        ".analysis-keys input:checked",
      ),
    ].map((e) => e.value);
    if (!keys.length || keys.length > 8) {
      notify("Select between 1 and 8 settings.");
      return;
    }
    $("#analysis-result").textContent =
      "Analysis queued. Up to 17 real slices; this can take several minutes.";
    $<HTMLButtonElement>("#run-analysis").disabled = true;
    const runButton = $<HTMLButtonElement>("#run-analysis");
    const analysisBundle = structuredClone(tuned);
    const analysisTarget = structuredClone(bundles[1 - selected]);
    const analysisModel = model;
    try {
      const job = await helper.call<{ id: string }>("/analyze", {
        bundle: analysisBundle,
        target: analysisTarget,
        model,
        keys,
      });
      const r = (await waitJob(job.id)) as unknown as {
        effects: {
          key: string;
          savedSeconds: number;
          conditionalSavedSeconds: number;
          simulationOnly?: boolean;
        }[];
        interactionResidualSeconds: number;
        method: string;
        combinedSeconds: number;
      };
      if (!runButton.isConnected) return;
      $("#analysis-result").innerHTML =
        `<table><thead><tr><th>Setting</th><th>Alone: seconds saved</th><th>After prior changes</th></tr></thead><tbody>${r.effects.map((e) => `<tr><td>${escape(settings.find((s) => s[0] === e.key)?.[1] || motionExperiments.find((s) => s[0] === e.key)?.[1] || e.key)}</td><td>${e.savedSeconds.toFixed(1)}</td><td>${e.conditionalSavedSeconds.toFixed(1)}</td></tr>`).join("")}</tbody></table><p>Combined estimate: ${duration(r.combinedSeconds)}. Interaction residual: ${r.interactionResidualSeconds.toFixed(1)} seconds. Negative savings mean slower. These substitutions explain only their measured effects; untested machine, quality and project settings may explain the remaining gap.</p><button id="apply-analysis" ${r.effects.some((e) => e.simulationOnly) ? "disabled" : ""}>Apply analyzed combination and verify</button><small>${escape(r.method)}</small>`;
      $("#apply-analysis").onclick = () => {
        if (
          model !== analysisModel ||
          JSON.stringify(tuned) !== JSON.stringify(analysisBundle)
        ) {
          notify("Conditions changed; run analysis again.");
          return;
        }
        for (const e of r.effects) {
          const kind = settings.find((s) => s[0] === e.key)![3];
          tuned[kind][e.key] = structuredClone(analysisTarget[kind][e.key]);
        }
        revisions[2]++;
        tuningDue = 0;
        clearTimeout(timer);
        states[2] = "Stale · analyzed changes applied";
        $<HTMLDialogElement>("#modal").close();
        renderCompare();
        void slice(2);
      };
    } catch (e) {
      if (runButton.isConnected) $("#analysis-result").textContent = String(e);
    } finally {
      runButton.disabled = false;
    }
  };
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function navigate(next: string) {
  view = next;
  document
    .querySelectorAll("[data-nav]")
    .forEach((e) =>
      e.classList.toggle("active", (e as HTMLElement).dataset.nav === next),
    );
  $("#compare").hidden = next !== "Compare & Tune";
  $("#other").hidden = next === "Compare & Tune";
  if (next === "Settings") renderSettings();
  if (next === "Saved Presets") renderPresets();
  if (next === "Print Lab") renderLab();
}
function renderPresets() {
  const all = presets();
  $("#other").innerHTML =
    `<h2>Saved Presets</h2><p>Local experiments · ${all.length} saved. Exported JSON can be imported through OrcaSlicer’s Import Configs menu.</p><div class="saved-grid">${all.map((p, i) => `<article class="saved-card"><h3>${escape(p.name)}</h3><p>${escape(p.bundle.machine.name)}</p><p>${p.summary ? duration(p.summary.seconds) + " · saved estimate; re-slice to install" : "Unverified experiment"}</p><small>${escape(p.created)}</small><div class="actions"><button data-load="${i}">Load</button><button data-export="${i}">Export JSON</button><button data-delete="${i}">Delete</button></div></article>`).join("") || "<p>No saved experiments yet. Use Save Preset in Live Tuning.</p>"}</div>`;
  document.querySelectorAll<HTMLElement>(".saved-card").forEach((card, i) => {
    const status = sourceStatus(all[i].bundle, library);
    if (status) {
      const note = document.createElement("p");
      note.className = "source-warning";
      note.textContent = status;
      card.append(note);
    }
  });
  document.querySelectorAll<HTMLElement>("[data-load]").forEach(
    (e) =>
      (e.onclick = () => {
        tuned = structuredClone(all[Number(e.dataset.load)].bundle);
        tunedDemo = all[Number(e.dataset.load)].demo ?? true;
        summaries[2] = undefined;
        revisions[2]++;
        tuningDue = 0;
        clearTimeout(timer);
        states[2] = "Loaded experiment · re-slice required";
        navigate("Compare & Tune");
        renderCompare();
        if (model && connected && !tunedDemo) slice(2);
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-export]").forEach(
    (e) =>
      (e.onclick = () => {
        const p = all[Number(e.dataset.export)];
        modal(
          '<h2>Export Orca presets</h2><p>Download each file, then import all three through OrcaSlicer’s Import Configs menu. These exports may contain private profile data.</p><div class="actions">' +
            ["machine", "process", "filament"]
              .map(
                (kind) =>
                  `<button data-export-kind="${kind}">Download ${kind}.json</button>`,
              )
              .join("") +
            "</div>",
        );
        Object.entries(p.bundle).forEach(([k, v]) => {
          const exported: Profile = {
            ...v,
            name: `${p.name} - ${k}`,
            inherits: "",
            from: "User",
            is_custom_defined: "1",
          };
          for (const key of [
            "__sp_scope",
            "include",
            "includes",
            "renamed_from",
            "setting_id",
          ])
            delete exported[key];
          if (k === "machine") {
            exported.default_print_profile = `${p.name} - process`;
            exported.default_filament_profile = [`${p.name} - filament`];
            exported.printer_settings_id = exported.name;
          } else {
            exported.compatible_printers = [`${p.name} - machine`];
            if (k === "process") exported.print_settings_id = exported.name;
            else exported.filament_settings_id = [exported.name];
          }
          $(`[data-export-kind="${k}"]`).onclick = () =>
            download(`${exported.name}.json`, exported);
        });
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-delete]").forEach(
    (e) =>
      (e.onclick = () => {
        all.splice(Number(e.dataset.delete), 1);
        localStorage.setItem("speed-printer-presets", JSON.stringify(all));
        renderPresets();
      }),
  );
}
function renderSettings() {
  $("#other").innerHTML =
    `<h2>Local companion settings</h2><p>Run SpeedPrinterHelper.exe. This website discovers it on this PC. On first connection, approve the website in the Windows helper dialog. Future visits reconnect automatically. Browser local/loopback access may need permission in site settings. Use the short code below only as a fallback.</p><div class="form-grid"><label>Fallback pairing code<input id="token" type="password" autocomplete="off" placeholder="Copy from the helper tray menu"></label><button id="pair" class="primary">Pair local helper</button><button id="reconnect">Retry connection / approval</button><button id="revoke">Revoke this browser</button></div><p id="pair-status">${connected ? "Connected · browser trust remembered" : "Disconnected · start the helper or pair this browser"}</p><p>Trusted browsers reconnect automatically. Closing helper Settings keeps it running; Exit in its tray menu stops it. Start with Windows is optional and off by default.</p><h3>Orca profile library</h3><button id="refresh-settings">Refresh from OrcaSlicer</button><p>One local permission imports configured printers and compatible saved presets. Refresh adds new presets and flags changed or missing sources without replacing experiment snapshots. Portable and account overrides are in the helper tray Settings.</p><h3>Manual fallback</h3><p>Import JSON files from Compare &amp; Tune. Export the three profiles from Saved Presets and use OrcaSlicer → Import Configs. Verified estimates require the local helper.</p><h3>Privacy</h3><p>Browser trust uses a non-exportable signing key in IndexedDB; no persistent bearer token is stored in page storage. Helper trust and profile cache use Windows protection. Scripts running on this trusted web origin can request signing; protect this browser and account. Profile snapshots and experiments stay local. Moonraker API keys remain in memory.</p><a href="https://github.com/khisanthax/Speed-Printer/releases/latest" target="_blank" rel="noreferrer">Download the Windows tray helper ↗</a>`;
  $("#pair").onclick = async () => {
    const code = $<HTMLInputElement>("#token").value.trim();
    $<HTMLInputElement>("#token").value = "";
    try {
      await helper.pair(code);
      await connect();
      $("#pair-status").textContent = "Connected · browser trust remembered";
      notify("Browser paired. Future sessions reconnect automatically.");
    } catch (e) {
      connected = false;
      helper.token = "";
      $("#pair-status").textContent = String(e);
    }
  };
  $("#reconnect").onclick = () => {
    helper.retryApproval();
    void connect().catch((e) => {
      $("#pair-status").textContent = String(e);
    });
  };
  $("#revoke").onclick = async () => {
    try {
      await helper.revoke();
      setConnected(false);
      $("#pair-status").textContent =
        "Pairing revoked. Copy a new code to trust this browser again.";
    } catch (e) {
      notify(String(e));
    }
  };
  $("#refresh-settings").onclick = () => void refreshLibrary();
}
let helperInstance = "";
function setConnected(value: boolean) {
  connected = value;
  $("#connection-state").textContent = value
    ? "Local helper connected"
    : helper.connectionStatus;
  $("#connection-dot").classList.toggle("online", value);
  const status = document.querySelector("#pair-status");
  if (status) status.textContent = value ? "Connected · browser trust remembered" : helper.connectionStatus;
}
let connecting: Promise<void> | undefined;
function connect() {
  return connecting ||= connectNow().finally(() => { connecting = undefined; });
}
async function connectNow() {
  if (!helper.token) await helper.discover();
  const health = await helper.call<{
    orcaFound: boolean;
    instance?: string;
    sharedLayout?: boolean;
  }>("/health");
  if (
    helperInstance &&
    health.instance &&
    helperInstance !== health.instance &&
    model
  ) {
    model = "";
    modelRevision++;
    verifiedLayout = undefined;
    verifiedModelHash = undefined;
    pendingSlices.clear();
    completedSlices.clear();
    clearTimeout(timer);
    $<HTMLButtonElement>("#slice-all").hidden = true;
    modelName = "Helper restarted · select the common model again";
    $("#model-name").textContent = modelName;
    states = states.map((_, i) =>
      summaries[i] ? "Stale · helper restarted" : "Not sliced",
    );
    updateSummaries();
  }
  sharedLayoutSupported = Boolean(health.sharedLayout);
  helperInstance = health.instance || "";
  const wasConnected = connected;
  setConnected(true);
  if (!wasConnected) {
    const result = await helper.call<Library>("/library");
    acceptLibrary(result);
    await restoreLibrary();
    if (library?.imported) void refreshLibrary(false);
  }
}
type Job = {
  filename: string;
  status: string;
  print_duration?: number;
  total_duration?: number;
  filament_used?: number;
  metadata?: Record<string, unknown>;
};
function renderLab() {
  $("#other").innerHTML =
    `<h2>Print Lab</h2><p>Read-only Moonraker history · latest 100 jobs per request. Completed history may lack profile settings and feature time breakdowns.</p><div class="form-grid"><label>Printer<select id="lab-printer">${["Mercury One", "Mercury Two", "SV08", "Other printer"].map((p) => `<option>${p}</option>`).join("")}</select></label><label>Moonraker origin<input id="moon-url" placeholder="http://192.168.x.x:7125"></label><label>API key (optional, memory only)<input id="moon-key" type="password" autocomplete="off"></label><button id="fetch-history" class="primary">Read job history</button><button id="fetch-limits">Read Klipper limits</button></div><div class="form-grid"><label>Equivalent model identity<input id="model-group" placeholder="Known model hash or your verified model label"></label><label>Conditions<input id="conditions" placeholder="Material, nozzle, scale, quality, cooling, overrides"></label></div><p>Filename similarity alone is not a verified match. Supply equivalent model identity and conditions before grouping jobs. Manual groups are your assertions; metadata cannot establish historical settings.</p><div class="actions"><button id="lab-demo">Show labeled demo history</button><button id="clear-history">Clear in-memory history</button><button id="compare-jobs">Compare selected equivalent jobs</button></div><div id="cohort-result"></div><div id="lab-results"></div><div id="limits"></div>`;
  let groups: {
    printer: string;
    model: string;
    conditions: string;
    demo: boolean;
    jobs: Job[];
  }[] = [];
  const draw = () => {
    $("#lab-results").innerHTML = groups
      .map(
        (g, gi) =>
          `<h3>${escape(g.printer)} ${g.demo ? "· DEMO FIXTURE" : ""}</h3><p>Select only jobs you have verified use the same model and conditions. Each request returns unfiltered history.</p><table><thead><tr><th>Select / file / outcome</th><th>Print duration</th><th>Estimated</th><th>Total duration</th><th>Filament</th><th>Estimate error</th></tr></thead><tbody>${g.jobs
            .map((j, ji) => {
              const estimate = Number(j.metadata?.estimated_time) || undefined;
              return `<tr><td><input type="checkbox" aria-label="Select ${escape(j.filename)} from ${escape(g.printer)}" data-history-job="${gi}:${ji}" ${j.status !== "completed" ? "disabled" : ""}> ${escape(j.filename)}<small>${escape(j.status)}</small></td><td>${duration(j.print_duration)}</td><td>${duration(estimate)}</td><td>${duration(j.total_duration)}</td><td>${j.filament_used === undefined ? "Missing" : (j.filament_used / 1000).toFixed(2) + " m"}</td><td>${j.status === "completed" && estimate && j.print_duration !== undefined ? ((j.print_duration / estimate - 1) * 100).toFixed(1) + "%" : "Not comparable"}</td></tr>`;
            })
            .join("")}</tbody></table>`,
      )
      .join("");
  };
  $("#compare-jobs").onclick = () => {
    try {
      const rows = [
        ...document.querySelectorAll<HTMLInputElement>(
          "[data-history-job]:checked",
        ),
      ].map((e) => {
        const [gi, ji] = e.dataset.historyJob!.split(":").map(Number);
        return { printer: groups[gi].printer, job: groups[gi].jobs[ji] };
      });
      const result = compareCohort(
        rows,
        $<HTMLInputElement>("#model-group").value,
        $<HTMLInputElement>("#conditions").value,
      );
      $("#cohort-result").innerHTML =
        "<h3>User-verified equivalent cohort</h3><p>This grouping is based on your explicit model/conditions assertion, not inferred historical profiles.</p><table><tr><th>Printer</th><th>Completed jobs</th><th>Mean print duration</th><th>Mean estimate (available count)</th></tr>" +
        result
          .map(
            (r) =>
              `<tr><td>${escape(r.printer)}</td><td>${r.count}</td><td>${duration(r.meanPrintSeconds)}</td><td>${duration(r.meanEstimateSeconds)} (${r.estimateCount})</td></tr>`,
          )
          .join("") +
        "</table>";
    } catch (e) {
      notify(String(e));
    }
  };
  $("#fetch-history").onclick = async () => {
    if (!requireHelper()) return;
    try {
      const r = await helper.call<{ result: { jobs: Job[] } }>("/history", {
        url: $<HTMLInputElement>("#moon-url").value,
        apiKey: $<HTMLInputElement>("#moon-key").value,
      });
      groups.push({
        printer: $<HTMLSelectElement>("#lab-printer").value,
        model: $<HTMLInputElement>("#model-group").value,
        conditions: $<HTMLInputElement>("#conditions").value,
        demo: false,
        jobs: r.result.jobs,
      });
      draw();
    } catch (e) {
      notify(String(e));
    }
  };
  $("#fetch-limits").onclick = async () => {
    if (!requireHelper()) return;
    try {
      const r = await helper.call<{
        result: {
          status: {
            toolhead?: Record<string, unknown>;
            configfile?: { settings?: { printer?: Record<string, unknown> } };
          };
        };
      }>("/limits", {
        url: $<HTMLInputElement>("#moon-url").value,
        apiKey: $<HTMLInputElement>("#moon-key").value,
      });
      const t = r.result.status.toolhead || {},
        p = r.result.status.configfile?.settings?.printer || {};
      $("#limits").textContent =
        `Reported Klipper limits: velocity ${t.max_velocity ?? p.max_velocity ?? "missing"} mm/s; acceleration ${t.max_accel ?? p.max_accel ?? "missing"} mm/s². Current/configured limits are not proven safe operating limits.`;
    } catch (e) {
      notify(String(e));
    }
  };
  $("#lab-demo").onclick = () => {
    groups.push({
      printer: "Mercury One",
      model: "DEMO 20 mm cube",
      conditions: "DEMO PLA / 0.4 nozzle / 0.2 mm layer",
      demo: true,
      jobs: [
        {
          filename: "demo-cube.gcode",
          status: "completed",
          print_duration: 720,
          total_duration: 810,
          filament_used: 1800,
          metadata: { estimated_time: 690 },
        },
        {
          filename: "demo-missing.gcode",
          status: "cancelled",
          print_duration: 120,
          total_duration: 190,
        },
      ],
    });
    draw();
  };
  $("#clear-history").onclick = () => {
    groups = [];
    draw();
    $("#cohort-result").innerHTML = "";
  };
}
document
  .querySelectorAll<HTMLElement>("[data-nav]")
  .forEach((e) => (e.onclick = () => navigate(e.dataset.nav!)));
$("#connection").onclick = () => navigate("Settings");
$("#help").onclick = () => navigate("Settings");
$("#slice-all").onclick = sliceAll;
$("#choose-model").onclick = async () => {
  if (!requireHelper()) return;
  if (isDemo.some(Boolean) || tunedDemo) {
    notify(
      "Select real printer, process and filament profiles in both columns first.",
    );
    return;
  }
  if (!sharedLayoutSupported) {
    notify(
      "Update the tray helper to v0.3.0 for a shared project arrangement.",
    );
    return;
  }
  $<HTMLButtonElement>("#choose-model").disabled = true;
  try {
    const r = await helper.call<{ id: string; name: string }>("/model", {
      bundles: [bundles[0], bundles[1], tuned],
    });
    model = r.id;
    modelName = r.name;
    modelRevision++;
    verifiedLayout = undefined;
    verifiedModelHash = undefined;
    revisions.forEach((_, i) => revisions[i]++);
    pendingSlices.clear();
    completedSlices.clear();
    clearTimeout(timer);
    tuningDue = 0;
    states = states.map((_, i) =>
      summaries[i] ? "Stale — common model changed" : "Not sliced",
    );
    $("#model-name").textContent = modelName;
    $<HTMLButtonElement>("#slice-all").hidden = false;
    updateSummaries();
    sliceAll();
  } catch (e) {
    notify(String(e));
  } finally {
    $<HTMLButtonElement>("#choose-model").disabled = false;
  }
};
renderCompare();
const refreshButton = document.createElement("button");
refreshButton.id = "refresh-library";
refreshButton.textContent = "Refresh from OrcaSlicer";
$(".workspace-status").append(refreshButton);
refreshButton.onclick = () => void refreshLibrary();
void connect().catch(() => setConnected(false));
setInterval(() => void connect().catch(() => setConnected(false)), 10000);
setInterval(() => {
  if (connected && library?.imported) void refreshLibrary(false);
}, 60000);
