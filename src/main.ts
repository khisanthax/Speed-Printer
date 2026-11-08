import "./style.css";
import "./layout.css";
import { Helper } from "./api";
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
let connected = false,
  model = "",
  modelName = "No common model selected",
  selected = 0,
  timer: ReturnType<typeof setTimeout>,
  syncing = false;
let tuningBusy = false,
  tuningQueued = false;
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
<main><div class="page-heading"><div><h1>3D Printer Profile Comparison & Tuning</h1><p>Compare two printers, tune your profile, and install directly into OrcaSlicer.</p></div><button id="choose-model">＋ Common model / 3MF</button></div><div class="workspace-status"><span id="model-name">${modelName}</span><span id="notice">Demo profiles · import your profiles to begin a verified comparison.</span></div><section id="compare" class="columns"></section><section id="other" hidden></section></main>
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
    `<h2>Comparison conditions</h2><table><thead><tr><th>Condition</th><th>A</th><th>B</th></tr></thead><tbody>${conditions}</tbody></table><p>Saved profiles compare complete recipes, including supports, quality, cooling, flow limits and machine constraints. The difference in total time cannot be attributed to printer speed alone.</p><p>Common-process mode uses A’s entire process on both printers, retaining each machine and calibrated filament. Filament and machine differences still matter. All project parts are auto-arranged on one plate; placement may differ by bed size. Embedded object settings remain part of the common project.</p><div class="actions"><button id="common-process">Use A’s process on both</button><button id="restore-process">Restore imported processes</button></div><table><thead><tr><th>Effective setting</th><th>A</th><th>B</th></tr></thead><tbody>${differences.join("")}</tbody></table>`,
  );
  const apply = () => {
    summaries = [undefined, undefined, undefined];
    states = ["Not sliced", "Not sliced", "Not sliced"];
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    clearTimeout(timer);
    $<HTMLDialogElement>("#modal").close();
    renderCompare();
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
          : `<input aria-label="${s[1]} slider" type="range" data-key="${s[0]}" min="${s[4]}" max="${s[5]}" step="${s[5] <= 1 ? 0.01 : 1}" value="${n ?? s[4]}" ${n === null ? "disabled" : ""}><input id="number-${s[0]}" aria-label="${s[1]} value" type="number" data-key="${s[0]}" min="${s[4]}" max="${s[5]}" step="${s[5] <= 1 ? 0.01 : 1}" value="${n ?? ""}" ${n === null ? "disabled" : ""}><span class="unit">${s[2]}</span>`;
      return `<div class="setting-row ${diff ? "diff" : ""}"><span class="setting-icon">${s[3] === "filament" ? "♧" : "ϟ"}</span><label ${i === 2 ? `for="number-${s[0]}"` : ""} title="${s[0]}">${s[1]}${s[0] === "default_acceleration" ? '<small title="Zero delegates acceleration to firmware where supported; verify Klipper and slicer machine limits."> ⓘ</small>' : ""}</label>${i === 2 ? controls : `<strong>${escape(display(b, s))}</strong>`}</div>`;
    })
    .join("");
}
function summary(i: number) {
  const s = summaries[i];
  const b = summaries[1 - selected];
  const pct = s && b ? (s.seconds / b.seconds - 1) * 100 : undefined;
  return `<div class="section-title"><h2><span>▥</span> ${i === 2 ? "Live Summary" : "Summary"}</h2>${i === 2 ? '<div><button class="small" id="export-project">Export 3MF</button><button class="small" id="reslice">↻ Re-slice</button></div>' : `<span class="chip">${s ? "OrcaSlicer result" : "Awaiting slice"}</span>`}</div><div class="time-metric"><span>◷ &nbsp; Estimated print time</span><div class="time-value"><strong>${duration(s?.seconds)}</strong>${s ? `<small>${s.seconds.toLocaleString()} s · exact engine estimate</small>` : ""}</div></div><div class="metric"><span>▤ &nbsp; Filament used</span><strong>${s?.grams === undefined ? "Not provided" : s.grams.toFixed(2) + " g"}</strong><small>${s?.meters === undefined ? "" : s.meters.toFixed(2) + " m"}</small></div><div class="metric"><span>♧ &nbsp; Support material</span><strong>Not separately provided</strong></div><div class="metric"><span>⌁ &nbsp; Travel / feature breakdown</span><strong>Not provided by engine</strong></div><div class="result-status ${states[i].includes("Stale") ? "stale" : ""}">${escape(states[i])}${pct === undefined ? "" : ` · ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% vs target`}</div>${i === 2 ? `<div class="safety">Faster estimates do not establish safe hardware limits.</div><div class="actions"><button id="reset">↶ Reset</button><button id="save">♧ Save Preset</button><button id="install" class="primary">♙ Install in OrcaSlicer</button></div>` : `<button data-slice="${i}" class="slice">Slice ${i === 0 ? "current" : "target"} profile</button><small class="source">${s ? escape(s.source) + (s.objectCount ? ` · ${s.objectCount} objects` : "") + (s.notes?.length ? `<details><summary>Project scope / compatibility</summary>${s.notes.map((note) => `<p>${escape(note)}</p>`).join("")}</details>` : "") : "Real estimates appear after local slicing completes."}</small>`}`;
}
function renderCompare() {
  const scroll = $<HTMLElement>(".settings-scroll")?.scrollTop || 0;
  $("#compare").innerHTML = [0, 1, 2]
    .map(
      (i) =>
        `<article class="column col-${i}"><div class="column-heading"><span>${i === 2 ? "☷" : "♙"}</span><div><h2>${["A — Current Printer", "B — Target Printer", "C — Live Tuning"][i]}</h2>${i === 2 ? `<small>Tune ${escape(bundles[selected].machine.name)} to match ${escape(bundles[1 - selected].machine.name)}</small>` : ""}</div></div>${profileInfo(i)}<section class="settings section"><div class="section-title"><h2><span>⚙</span> ${i === 2 ? "Live Adjustment Controls" : "Profile Settings"}</h2>${i === 2 ? '<button id="analyze" class="small">ϟ Analyze impact</button>' : `<span class="chip">${escape(bundles[i].process.layer_height || "—")} mm</span>`}</div><div class="settings-banner">ϟ ${i === 2 ? "Scroll linked across columns (synced scroll)" : "Speed-Affecting Settings (OrcaSlicer)"}<small>${i === 2 ? "Values require re-slicing" : "ⓘ Scroll linked across columns"}</small></div><div class="settings-scroll">${rows(i)}</div><div class="settings-foot">${i === 2 ? "Acceleration 0: firmware controlled where supported." : "Highlighted rows differ between profiles."}</div></section><section class="summary section" id="summary-${i}">${summary(i)}</section></article>`,
    )
    .join("");
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
  document
    .querySelectorAll<HTMLButtonElement>("[data-slice]")
    .forEach((el) => (el.onclick = () => void slice(Number(el.dataset.slice))));
  $("#modify").onchange = () => {
    selected = Number($<HTMLSelectElement>("#modify").value);
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    summaries[2] = undefined;
    states[2] = "Not sliced";
    renderCompare();
  };
  document.querySelectorAll<HTMLInputElement>("[data-key]").forEach((el) =>
    el.addEventListener("input", () => {
      if (el.type === "number" && el.value.trim() === "") return;
      const value =
        el.type === "checkbox" ? Number(el.checked) : Number(el.value);
      try {
        tuned = changed(tuned, el.dataset.key!, value);
      } catch (e) {
        notify(String(e));
        return;
      }
      document
        .querySelectorAll<HTMLInputElement>(`[data-key="${el.dataset.key}"]`)
        .forEach((other) => {
          if (other.type !== "checkbox") other.value = String(value);
        });
      states[2] = summaries[2]
        ? "Stale · settings changed"
        : "Pending · settings changed";
      updateSummaries();
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (connected && model && !tunedDemo) void slice(2);
        else {
          states[2] =
            "Pending · connect helper, import profiles and choose model";
          updateSummaries();
        }
      }, 650);
    }),
  );
  $("#reset").onclick = () => {
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    summaries[2] = undefined;
    states[2] = "Not sliced";
    renderCompare();
  };
  $("#reslice").onclick = () => void slice(2);
  $("#export-project").onclick = () => void exportProject();
  $("#save").onclick = savePreset;
  $("#install").onclick = () => void install();
  $("#analyze").onclick = analysisDialog;
}
function updateSummaries() {
  [0, 1, 2].forEach((i) => {
    $(`#summary-${i}`).innerHTML = summary(i);
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-slice]")
    .forEach((el) => (el.onclick = () => void slice(Number(el.dataset.slice))));
  $("#reset").onclick = () => {
    tuned = structuredClone(bundles[selected]);
    tunedDemo = isDemo[selected];
    summaries[2] = undefined;
    states[2] = "Not sliced";
    renderCompare();
  };
  $("#reslice").onclick = () => void slice(2);
  $("#export-project").onclick = () => void exportProject();
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
async function slice(i: number) {
  if (!requireHelper()) return;
  if (!model) {
    notify("Choose a common model first.");
    return;
  }
  if (i === 2 ? tunedDemo : isDemo[i]) {
    notify(
      "Import real machine, process and filament presets before slicing. Demo profiles are incomplete examples.",
    );
    return;
  }
  const b = structuredClone(i === 2 ? tuned : bundles[i]);
  if (i === 2 && tuningBusy) {
    tuningQueued = true;
    states[2] = summaries[2]
      ? "Stale · latest changes queued"
      : "Pending · latest changes queued";
    updateSummaries();
    return;
  }
  if (i === 2) tuningBusy = true;
  const selectedModel = model;
  const matchesCurrent = () =>
    model === selectedModel &&
    JSON.stringify(i === 2 ? tuned : bundles[i]) === JSON.stringify(b);
  states[i] = summaries[i] ? "Stale · slicing…" : "Slicing…";
  updateSummaries();
  try {
    const job = await helper.slice(b, model);
    const result = await waitJob(job.id);
    if (!matchesCurrent()) return;
    summaries[i] = result;
    states[i] = "Verified local slice · " + new Date().toLocaleTimeString();
    updateSummaries();
  } catch (e) {
    if (!matchesCurrent()) return;
    states[i] = (summaries[i] ? "Stale · " : "") + String(e);
    updateSummaries();
  } finally {
    if (i === 2) {
      tuningBusy = false;
      if (tuningQueued) {
        tuningQueued = false;
        clearTimeout(timer);
        void slice(2);
      }
    }
  }
}
function importDialog(i: number) {
  modal(
    `<h2>Import ${i === 0 ? "current" : "target"} profiles</h2><p>Import a machine, process and filament JSON, plus all inherited parents. Or read installed profiles with local permission.</p><div class="actions"><button id="manual-import">Import JSON files</button><button id="local-import">Read local Orca profiles</button><button id="portable-import">Choose portable folder</button></div><div id="selectors"></div>`,
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
      const result = await helper.call<{
        profiles: Profile[];
        warnings: string[];
      }>("/profiles", { chooseRoot: portable });
      catalog = result.profiles;
      choose();
      if (result.warnings.length)
        notify(result.warnings.slice(0, 3).join("; "));
    } catch (e) {
      notify(String(e));
    }
  };
  $("#local-import").onclick = () => void local();
  $("#portable-import").onclick = () => void local(true);
  if (catalog.length) choose();
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
      await helper.call("/install", {
        bundle: tuned,
        name: $<HTMLInputElement>("#install-name").value,
      });
      $<HTMLDialogElement>("#modal").close();
      notify(
        "Three new presets installed. Reopen OrcaSlicer and select the new machine, process and filament.",
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
  document.querySelectorAll<HTMLElement>("[data-load]").forEach(
    (e) =>
      (e.onclick = () => {
        tuned = structuredClone(all[Number(e.dataset.load)].bundle);
        tunedDemo = all[Number(e.dataset.load)].demo ?? true;
        summaries[2] = undefined;
        states[2] = "Loaded experiment · re-slice required";
        navigate("Compare & Tune");
        renderCompare();
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
    `<h2>Local companion settings</h2><p>The web app runs on free static hosting. Profiles, model files, slicing, and Moonraker connections stay on your PC.</p><ol><li>Install Python 3.11+ or download SpeedPrinterHelper.exe from the repository’s latest successful CI run.</li><li>Run <code>python helper/server.py</code> (or the packaged EXE).</li><li>Paste the session pairing token from the helper console. It is kept in memory only.</li></ol><div class="form-grid"><label>Session pairing token<input id="token" type="password" autocomplete="off" placeholder="Paste local helper token"></label><button id="pair" class="primary">Pair local helper</button></div><p id="pair-status">${connected ? "Connected" : "Disconnected"}</p><p>Browser local-network permission may be required. If your browser blocks hosted-to-local access, run <code>npm run dev</code> and use the local web app.</p><h3>Manual fallback</h3><p>Import JSON files from Compare & Tune. Save an experiment and export its three JSON profiles from Saved Presets, then use OrcaSlicer → File → Import → Import Configs. Real recalculation requires the helper.</p><h3>Privacy and limits</h3><p>Pairing tokens and Moonraker API keys are never persisted. Saved presets are stored in this browser; private settings and custom G-code can be included. Clear saved experiments on shared PCs. A faster estimate does not prove the printer can safely operate at those limits.</p><a href="https://github.com/khisanthax/Speed-Printer" target="_blank" rel="noreferrer">Source, setup documentation and helper downloads ↗</a>`;
  $("#pair").onclick = async () => {
    helper.token = $<HTMLInputElement>("#token").value.trim();
    $<HTMLInputElement>("#token").value = "";
    try {
      const h = await helper.call<{ orcaFound: boolean }>("/health");
      connected = true;
      $("#pair-status").textContent = h.orcaFound
        ? "Connected · Orca executable found"
        : "Connected · configure --orca with a valid executable";
      $("#connection-state").textContent = "Local helper paired";
      $("#connection-dot").classList.add("online");
      notify("Helper paired for this browser session.");
    } catch (e) {
      connected = false;
      helper.token = "";
      $("#pair-status").textContent = String(e);
    }
  };
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
$("#choose-model").onclick = async () => {
  if (!requireHelper()) return;
  try {
    const r = await helper.call<{ id: string; name: string }>("/model", {});
    model = r.id;
    modelName = r.name;
    summaries = [undefined, undefined, undefined];
    states = ["Not sliced", "Not sliced", "Not sliced"];
    $("#model-name").textContent = modelName;
    updateSummaries();
  } catch (e) {
    notify(String(e));
  }
};
renderCompare();
