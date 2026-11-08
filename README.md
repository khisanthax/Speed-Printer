# Speed Printer

Compare OrcaSlicer presets, measure model-specific speed effects with real local slicing, and save and install new presets. The desktop interface follows the supplied approved three-column mockup.

- **Web app:** https://khisanthax.github.io/Speed-Printer/
- **Source:** https://github.com/khisanthax/Speed-Printer
- **Windows helper:** [download the latest release](https://github.com/khisanthax/Speed-Printer/releases/latest), including `SpeedPrinterHelper.exe` and its SHA-256 checksum. The EXE is unsigned; source execution is also supported. Per-commit builds are also available as `SpeedPrinterHelper-Windows` artifacts under [Actions](https://github.com/khisanthax/Speed-Printer/actions).

## Quick start

Requires Node 22.12+ for development, Python 3.11+ for the source helper, and an installed OrcaSlicer with working CLI support. The hosted web app needs no Node installation.

```powershell
git clone https://github.com/khisanthax/Speed-Printer.git
cd Speed-Printer
npm ci
npm run dev
```

In a separate terminal:

```powershell
python helper/server.py
# Portable / alternate Orca installation:
python helper/server.py --orca "D:\Apps\OrcaSlicer\orca-slicer.exe"
```

1. Open the hosted app or local URL printed by Vite. Use a desktop viewport, preferably 1672 × 941 or larger; the approved layout has a 1280 px minimum width.
2. Open **Settings**, paste the session token printed by the helper, and pair. The token stays in memory and is revoked when the helper stops. Never send it in chat or commit it.
3. Use **Import profiles** in A and B. Read local profiles (requires a native permission dialog), choose a portable directory, or select exported Orca JSON files including their parents. Choose one machine, process and filament for each column. Demo profiles are incomplete examples and cannot be sliced.
4. Choose **Common model / 3MF**. The helper opens a native file picker; models stay local. All project parts are auto-arranged onto one plate per printer; original multi-plate placement is not retained. The result includes the generated object count. Use **Compare conditions** to inspect all inherited differences or apply A’s complete process to both printers. Each printer keeps its calibrated material and machine limits. Slice A and B, then choose which printer C modifies.
5. Adjust sliders or numerical values. Recalculation debounces for 650 ms. Existing results are marked stale until a matching slice completes. **Analyze impact** runs controlled re-slices; select at most eight settings.
6. **Save Preset** stores an experiment in this browser. For installation, successfully slice C, use a new name, select the correct account directory in the native dialog, and confirm. Open a new Orca window (preserve unsaved projects) and select the new machine, process and filament presets.

Browser local-network permissions may be required for the hosted site to reach the helper. If blocked, use the local web app. Helper defaults allow only `http://127.0.0.1:5173`, `http://127.0.0.1:4173`, and `https://khisanthax.github.io`. Add a trusted origin with `--origin`; do not add untrusted shared sites. The GitHub Pages origin is shared across this account's Pages projects, so trust all content served from that origin before pairing.

## Import, inheritance and manual fallback

Orca presets reference named parents. Both browser and helper resolve inheritance and includes recursively within vendor namespaces, detect missing/ambiguous parents and cycles, and retain arrays and percentage values. System discovery supports JSON and Orca binary `.opc` cache format 2, including CRC validation; unsupported/corrupt caches produce warnings and require JSON export fallback. Unknown or absent values are shown as missing. Relative percentages retain their meaning and are not mislabeled as absolute speeds. Tuning array values changes the first filament/extruder entry and preserves other entries. Engine defaults not explicitly present in exported profiles are applied by Orca during slicing; the comparison table does not pretend to enumerate all version-specific defaults.

Standard roots are `%APPDATA%\OrcaSlicer\system`, `%APPDATA%\OrcaSlicer\user`, and `resources\profiles` beside the selected executable. Portable roots are explicitly chosen by the local user. Account directories generally live under `user\<account-id>` or `user\default`; select the folder containing `machine`, `process`, and `filament` when installing. The helper never selects an account silently.

If the helper is unavailable, import exported JSON manually, tune, save, then export the three JSON files from **Saved Presets**. Use OrcaSlicer **File → Import → Import Configs**. This fallback cannot calculate estimates in the browser. JSON exports may contain private profile settings and custom G-code: keep them private.

## What the estimates mean

Only a successful actual Orca slice can supply a verified estimate. The helper parses the normal-mode time and any available filament totals from the generated G-code. It does not synthesize support mass, feature percentages, travel counts or time breakdowns. Those fields remain missing when Orca does not supply them. Model and effective-settings hashes accompany results; cached results also depend on the selected engine file.

The analysis substitutes each selected setting toward the other profile, ranks the measured time changes, then re-slices the cumulative ranked path. The conditional gains and interaction residual expose non-additive effects. This is a model-specific, order-dependent experiment, not a universal importance ranking or a proof of optimal settings. Layer height, support, cooling, density and line width change print quality or conditions; include them intentionally. Orca's volumetric, acceleration and other machine constraints remain active.

Acceleration `0` is labeled firmware controlled where supported. Slicer machine limits and actual firmware configuration can still affect estimates. A faster result does not establish safe hardware capability. No commands are sent to a printer; validate motion, extrusion, cooling, adhesion and quality separately before printing.

## Print Lab

Choose Mercury One, Mercury Two, SV08 or another printer, enter its LAN Moonraker origin, and optionally supply an API key. The helper only reads job history and Klipper toolhead/config limits. Keys are not stored. History is kept in memory, not sent to hosting or committed.

Compare print duration, total duration, estimated duration, consumed filament and outcome. Only completed jobs with an estimate have an estimate error. Missing metadata stays missing; cancelled jobs are not treated as successful timing samples. History requests return unfiltered recent jobs: explicitly select equivalent completed jobs from at least two printers, enter a verified model identity and conditions (material, nozzle, scale, quality and overrides), then compare the selected cohort. Filenames alone do not establish equivalence. History may lack historical profile settings, overrides or time breakdowns; current Klipper settings cannot reconstruct them. Use a numeric private LAN IP and the actual Moonraker port; some multi-instance hosts use nonstandard ports. Hostnames are disabled to prevent DNS rebinding.

## Development and verification

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
python -m unittest discover -s helper -p "test_*.py" -v
# Optional: real local engine, bundled public presets, generated cube, temporary install:
python helper/smoke_orca.py --orca "C:\Program Files\OrcaSlicer\orca-slicer.exe"
# Optional browser-to-engine test, reads only bundled public presets:
$env:SPEED_PRINTER_LIVE_ORCA = "C:\Program Files\OrcaSlicer\orca-slicer.exe"
npm run test:e2e -- e2e/live-orca.spec.ts
```

CI tests the client in Chromium and Python helper on Windows and packages the companion with PyInstaller. GitHub Pages deploys static output from `main`. No Orca binaries are redistributed. See [ARCHITECTURE.md](ARCHITECTURE.md) and [LOGBOOK.md](LOGBOOK.md) for contracts, verification results and remaining integration limits.

## Security

The companion binds only `127.0.0.1:8377`, validates the Host and exact allowed Origin, and requires a random 256-bit session bearer token, including on reads. Local native permission protects profile discovery, model selection and installation. Requests are bounded, paths come from native pickers, subprocess arguments are passed without a shell, post-processing commands are rejected, and new preset files use exclusive creation with rollback on partial failure. Model parsing still runs a native slicer: import trusted models and keep Orca updated. Moonraker endpoints are restricted to private LAN addresses and fixed GET routes, with redirects and proxies disabled. Do not expose the helper through a tunnel or port forward.

Public fixtures and demos contain no private printer configurations or personal job history. Saved browser experiments can contain private data; clear them on shared computers. No analytics or cloud profile storage is used.

## Personal workflow compatibility

The helper recognizes user presets without an explicit type and resolves renamed system parents. For the demonstrated legacy 3MF raft expansion of `-1`, it normalizes that value to `0` only when rafts are disabled in both the project and selected process. It changes a private working snapshot, retains the original model hash and reports the normalization; the source file and geometry remain untouched. Enabled rafts require manual review. Project-level object overrides remain common inputs to both slices.

Supports have an on/off checkbox in Live Tuning. Support style, placement and interface settings remain visible in Compare conditions and can be edited in Orca before importing. Feature acceleration controls supplement the default acceleration; machine caps can constrain their effect. Controlled analysis can apply its exact tested combination, followed by a verified slice. Connection hosts and credential fields are removed from discovered/effective presets; configure a printer connection separately inside Orca if needed.

Use **Export 3MF** in the verified Live Summary to save the exact arranged comparison project, including Orca-generated slicing output. The helper re-slices before saving and requires a new filename. Open that export in Orca to retain the comparison arrangement. Opening the original two-plate project and slicing it separately can produce a different time because its placement/plate count differs.

The analysis also offers explicit simulation-only experiments for X/Y jerk limits and the extruding acceleration cap. These measure the effect of the target slicer limits, preserve the actual profiles/firmware, and disable applying the simulated combination. A simulated saving does not establish a safe motion limit. Default controls remain ordinary process/material tuning. Exact engine seconds accompany rounded hour/minute summaries.
