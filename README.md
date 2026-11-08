# Speed Printer

Compare OrcaSlicer presets, measure model-specific speed effects with real local slicing, and save and install new presets. The desktop interface follows the supplied approved three-column mockup.

- **Web app:** https://khisanthax.github.io/Speed-Printer/
- **Source:** https://github.com/khisanthax/Speed-Printer
- **Windows helper:** download `SpeedPrinterHelper-Windows` from a successful **Test and package** run under [Actions](https://github.com/khisanthax/Speed-Printer/actions). The EXE is unsigned; source execution is also supported.

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
4. Choose **Common model / 3MF**. The helper opens a native file picker; models stay local. Use a single plate. Slice A and B, then choose which printer C modifies.
5. Adjust sliders or numerical values. Recalculation debounces for 650 ms. Existing results are marked stale until a matching slice completes. **Analyze impact** runs controlled re-slices; select at most eight settings.
6. **Save Preset** stores an experiment in this browser. For installation, successfully slice C, use a new name, close Orca, select the correct account directory in the native dialog, and confirm. Reopen Orca and select the new machine, process and filament presets.

Browser local-network permissions may be required for the hosted site to reach the helper. If blocked, use the local web app. Helper defaults allow only `http://127.0.0.1:5173`, `http://127.0.0.1:4173`, and `https://khisanthax.github.io`. Add a trusted origin with `--origin`; do not add untrusted shared sites. The GitHub Pages origin is shared across this account's Pages projects, so trust all content served from that origin before pairing.

## Import, inheritance and manual fallback

Orca presets reference named parents. Both browser and helper resolve inheritance recursively, detect missing/ambiguous parents and cycles, and retain arrays and percentage values. Unknown or absent values are shown as missing. Engine defaults not explicitly present in exported profiles are applied by Orca during slicing; the comparison table does not pretend to enumerate all version-specific defaults.

Standard roots are `%APPDATA%\OrcaSlicer\system`, `%APPDATA%\OrcaSlicer\user`, and `resources\profiles` beside the selected executable. Portable roots are explicitly chosen by the local user. Account directories generally live under `user\<account-id>` or `user\default`; select the folder containing `machine`, `process`, and `filament` when installing. The helper never selects an account silently.

If the helper is unavailable, import exported JSON manually, tune, save, then export the three JSON files from **Saved Presets**. Use OrcaSlicer **File → Import → Import Configs**. This fallback cannot calculate estimates in the browser. JSON exports may contain private profile settings and custom G-code: keep them private.

## What the estimates mean

Only a successful actual Orca slice can supply a verified estimate. The helper parses the normal-mode time and any available filament totals from the generated G-code. It does not synthesize support mass, feature percentages, travel counts or time breakdowns. Those fields remain missing when Orca does not supply them. Model and effective-settings hashes accompany results; cached results also depend on the selected engine file.

The analysis substitutes each selected setting toward the other profile, ranks the measured time changes, then re-slices the cumulative ranked path. The conditional gains and interaction residual expose non-additive effects. This is a model-specific, order-dependent experiment, not a universal importance ranking or a proof of optimal settings. Layer height, support, cooling, density and line width change print quality or conditions; include them intentionally. Orca's volumetric, acceleration and other machine constraints remain active.

Acceleration `0` is labeled firmware controlled where supported. Slicer machine limits and actual firmware configuration can still affect estimates. A faster result does not establish safe hardware capability. No commands are sent to a printer; validate motion, extrusion, cooling, adhesion and quality separately before printing.

## Print Lab

Choose Mercury One, Mercury Two, SV08 or another printer, enter its LAN Moonraker origin, and optionally supply an API key. The helper only reads job history and Klipper toolhead/config limits. Keys are not stored. History is kept in memory, not sent to hosting or committed.

Compare print duration, total duration, estimated duration, consumed filament and outcome. Only completed jobs with an estimate have an estimate error. Missing metadata stays missing; cancelled jobs are not treated as successful timing samples. Enter a verified model identity and conditions (material, nozzle, scale, quality and overrides) before treating jobs as comparable. Filenames alone do not establish equivalence. History may lack historical profile settings, overrides or time breakdowns; current Klipper settings cannot reconstruct them.

## Development and verification

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
python -m unittest discover -s helper -p "test_*.py" -v
```

CI tests the client in Chromium and Python helper on Windows and packages the companion with PyInstaller. GitHub Pages deploys static output from `main`. No Orca binaries are redistributed. See [ARCHITECTURE.md](ARCHITECTURE.md) and [LOGBOOK.md](LOGBOOK.md) for contracts, verification results and remaining integration limits.

## Security

The companion binds only `127.0.0.1:8377`, validates the Host and exact allowed Origin, and requires a random 256-bit session bearer token, including on reads. Local native permission protects profile discovery, model selection and installation. Requests are bounded, paths come from native pickers, subprocess arguments are passed without a shell, post-processing commands are rejected, and new preset files use exclusive creation with rollback on partial failure. Model parsing still runs a native slicer: import trusted models and keep Orca updated. Moonraker endpoints are restricted to private LAN addresses and fixed GET routes, with redirects and proxies disabled. Do not expose the helper through a tunnel or port forward.

Public fixtures and demos contain no private printer configurations or personal job history. Saved browser experiments can contain private data; clear them on shared computers. No analytics or cloud profile storage is used.
