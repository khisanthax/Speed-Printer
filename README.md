# Speed Printer

Compare OrcaSlicer presets, measure model-specific speed effects with real local slicing, and save and install new presets. The desktop interface follows the supplied approved three-column mockup.

- **Web app:** https://khisanthax.github.io/Speed-Printer/
- **Source:** https://github.com/khisanthax/Speed-Printer
- **Windows tray helper:** download the EXE and SHA256SUMS from the [latest release](https://github.com/khisanthax/Speed-Printer/releases/latest). Exit an older console helper first. The EXE is unsigned and needs no installer.

## Quick start

Requires Node 22.12+ for development, Python 3.13+ for the source helper, and an installed OrcaSlicer with working CLI support. The hosted web app needs no Node installation.

```powershell
git clone https://github.com/khisanthax/Speed-Printer.git
cd Speed-Printer
npm ci
npm run dev
```

For source development, install dependencies with `pip install -r helper/requirements.txt`, then launch without a console:

```powershell
pythonw helper/tray.py
# Portable / alternate Orca installation:
pythonw helper/tray.py --orca "D:\Apps\OrcaSlicer\orca-slicer.exe"
```

1. Open the hosted app or local URL printed by Vite. Use a desktop viewport, preferably 1672 × 941 or larger; the approved layout has a 1280 px minimum width.
2. Run the EXE and open the website. It discovers only `127.0.0.1:8377` and requests native **Allow website?** approval showing the exact origin. Approve once; the browser proves possession of its non-exportable signing key, and trusted visits reconnect after browser/helper restarts. Discovery alone grants no access. If approval was declined, use **Settings → Retry connection / approval**. After revocation, explicitly pair again using the fallback code. **Fallback only:** right-click the tray icon → **Copy Pairing Code**, paste the eight-character code into Settings and pair. It expires after five minutes, is rate limited and consumed on success. Closing helper Settings leaves it running; tray **Exit** stops it. **Start with Windows** is off until explicitly enabled.
3. Click **Refresh from OrcaSlicer** and approve the native read dialog once. A and B now offer **Printer / Process / Filament**, with saved per-printer combinations. Cached profiles and comparison snapshots persist locally. Refresh finds new/changed presets; older snapshots and saved experiments are retained and flagged. Select the profile again to adopt updated settings. **Import / Advanced** provides manual JSON import, portable directory selection and collapsed full-catalog browsing. Demo profiles cannot be sliced.
4. Click **Select Model & Slice All**. Choose one STL/3MF in the native helper picker. Its filename stays prominent at the top, and A, B and C update as their actual Orca slices finish. The helper snapshots the chosen file and prepares one common arrangement for all three profiles. Untuned C reuses an identical completed source result. **Slice All** repeats the comparison with that model without reopening the picker. There are no separate per-column slice buttons.
5. Move a C slider, enter a number, or click **− / +**. Every valid change automatically recalculates C after a 650 ms pause. Whole-number controls step by 1, volumetric flow by 0.1, layer height/line width by 0.01 mm; the buttons stop at their limits. C immediately shows **Stale — recalculating** with progress. While Orca is busy, only the newest requested configuration is retained. Older completions cannot overwrite newer edits; A/B baselines stay unchanged. A failed slice clears C's estimate and explains the failure. If no model/helper is available, C explicitly asks for a model or the running tray helper. No Apply or manual C Slice action is needed. **Analyze impact** still runs controlled substitutions, up to eight settings.
6. **Save Preset** stores an experiment in this browser. For installation, successfully slice C, use a new name, select the correct account directory in the native dialog, and confirm. Open a new Orca window (preserve unsaved projects) and select the new machine, process and filament presets.

Browser local-network or loopback permissions may be required for the hosted site to reach the helper. If blocked, use the local web app. Helper defaults allow only `http://127.0.0.1:5173`, `http://127.0.0.1:4173`, and `https://khisanthax.github.io`. Add a trusted origin with `--origin`; do not add untrusted shared sites. The GitHub Pages origin is shared across this account's Pages projects, so trust all content served from that origin before pairing.

## Import, inheritance and manual fallback

Orca presets reference named parents. Both browser and helper resolve inheritance and includes recursively within vendor namespaces, detect missing/ambiguous parents and cycles, and retain arrays and percentage values. System discovery supports JSON and Orca binary `.opc` cache format 2, including CRC validation; unsupported/corrupt caches produce warnings and require JSON export fallback. Unknown or absent values are shown as missing. Relative percentages retain their meaning and are not mislabeled as absolute speeds. Tuning array values changes the first filament/extruder entry and preserves other entries. Engine defaults not explicitly present in exported profiles are applied by Orca during slicing; the comparison table does not pretend to enumerate all version-specific defaults.

Discovery prefers the running Orca executable, then registered/standard installations. It reads `OrcaSlicer.conf`: `presets.machine` is the current printer, `orca_presets` stores remembered per-printer combinations, `models` enables system printer/nozzle variants, and `filaments` enables system materials. The remembered map is not chronological history; no current selection is guessed from modification times. Project-only selections may have no disk preset and remain explicitly missing.

The active account uses `app.preset_folder`, a unique current-printer match, or Orca's offline default. Ambiguity requires a helper Settings override. Select portable/custom data and account directories there when standard discovery cannot identify them. Reading never changes Orca's active selections.

Default choices include saved user printers and enabled system variants, relevant compatible user presets, and remembered/default/enabled materials. Explicit `compatible_printers` lists take priority over conditions, with Orca's immediate-parent match for user printers. Arbitrary condition expressions aren't evaluated: unknown conditions are excluded unless Orca remembers that selection, which is labeled. Advanced deliberately exposes the full catalog. This supports the demonstrated personal profiles rather than claiming complete vendor-condition compatibility. References: [Orca compatibility and visibility](https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0-alpha/src/libslic3r/Preset.cpp), [saved selections](https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0-alpha/src/libslic3r/AppConfig.cpp).

If the helper is unavailable, import exported JSON manually, tune, save, then export the three JSON files from **Saved Presets**. Use OrcaSlicer **File → Import → Import Configs**. This fallback cannot calculate estimates in the browser. JSON exports may contain private profile settings and custom G-code: keep them private.

## One shared project

After each completed C recalculation, the status reports either the exact measured seconds faster/slower than its preceding result on that same project/layout, or **estimate unchanged for this model**. An unchanged rounded hour/minute display therefore does not imply that the automatic slice failed.

Version 0.3.0 of the helper is required for the new unified workflow. Existing pairing and the local profile library survive the upgrade; model handles and install validation remain session-local. Exit the older helper, run the new EXE, and open the updated website. A previously trusted browser reconnects automatically. Check the sidebar: the helper must be running for real estimates.

All printable instances in the selected file are included, with their quantities, object/part overrides and applicable project conditions. Orca prepares one arrangement on one common rectangular plate that fits the intersection of the selected printers' bed rectangles. Original multi-plate placement is not retained. That one arrangement is then fixed for A, B and C, with per-printer auto-arrange disabled. Exported geometry, world-space placement, instance counts, plate membership and object/part overrides are checked; a changed layout is rejected rather than compared. Each printer keeps its actual machine limits and calibrated profile settings. Embedded object overrides can make a slider have little or no effect; a completed estimate is measured, not a promise of a speedup.

For these personal printers the beds are rectangular. A non-rectangular bed, non-millimeter project, or project that cannot fit on one shared plate fails with an explanation; prepare a suitable comparison project in Orca. This does not add a separate plate/object-selection editor. To compare a subset, save that subset as a separate project in Orca before selecting it here. Selecting a different model invalidates every summary; changing C alone invalidates only C. Selecting a model again after a printer-bed change also recomputes the shared arrangement. Engine/geometry validation still does not establish physical safety.

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

The companion binds only `127.0.0.1:8377`, validates the Host and exact allowed Origin, and requires an ephemeral authenticated session, including on reads. Initial pairing registers a browser public key; one-use, origin-bound P-256 signed challenges resume trust. Browser private keys are non-exportable CryptoKeys in IndexedDB, not bearer strings in localStorage. Windows DPAPI protects helper trust, cached profiles and comparison snapshots under `%LOCALAPPDATA%\SpeedPrinter\state.dpapi`. Page scripts cannot export the private key, but scripts on the trusted origin can request signing: same-origin script compromise remains a trust boundary. Revoke one browser in web Settings or all browsers in tray Settings. Revoking all also requires profile-read permission again. Local native permission protects profile discovery, model selection and installation. Requests are bounded, paths come from native pickers, subprocess arguments are passed without a shell, post-processing commands are rejected, and new preset files use exclusive creation with rollback on partial failure. Model parsing still runs a native slicer: import trusted models and keep Orca updated. Moonraker endpoints are restricted to private LAN addresses and fixed GET routes, with redirects and proxies disabled. Do not expose the helper through a tunnel or port forward.

Public fixtures and demos contain no private printer configurations or personal job history. Saved browser experiments can contain private data; clear them on shared computers. No analytics or cloud profile storage is used.

## Personal workflow compatibility

The helper recognizes user presets without an explicit type and resolves renamed system parents. For the demonstrated legacy 3MF raft expansion of `-1`, it normalizes that value to `0` only when rafts are disabled in both the project and selected process. It changes a private working snapshot, retains the original model hash and reports the normalization; the source file and geometry remain untouched. Enabled rafts require manual review. Project-level object overrides remain common inputs to both slices.

Supports have an on/off checkbox in Live Tuning. Support style, placement and interface settings remain visible in Compare conditions and can be edited in Orca before importing. Feature acceleration controls supplement the default acceleration; machine caps can constrain their effect. Controlled analysis can apply its exact tested combination, followed by a verified slice. Connection hosts and credential fields are removed from discovered/effective presets; configure a printer connection separately inside Orca if needed.

Use **Export 3MF** in the verified Live Summary to save the exact arranged comparison project, including Orca-generated slicing output. The helper re-slices before saving and requires a new filename. Open that export in Orca to retain the comparison arrangement. Opening the original two-plate project and slicing it separately can produce a different time because its placement/plate count differs.

The analysis also offers explicit simulation-only experiments for X/Y jerk limits and the extruding acceleration cap. These measure the effect of the target slicer limits, preserve the actual profiles/firmware, and disable applying the simulated combination. A simulated saving does not establish a safe motion limit. Default controls remain ordinary process/material tuning. Exact engine seconds accompany rounded hour/minute summaries.

### Local discovery and browser restrictions

Discovery uses a fixed numeric loopback URL; no LAN scan or broadcast. The discovery response contains only helper version, instance and approval capability. Every route checks the exact Host and allowed Origin; private operations additionally require a short-lived session minted after a signed one-use challenge and remembered public-key trust. Origin checks alone do not authenticate a client. Native approval happens only after key proof verification, is rate limited, and cannot silently replace existing or revoked trust. Browser private keys stay non-exportable in IndexedDB; helper records use Windows DPAPI. No long-lived bearer is saved in localStorage.

HTTPS Pages can contact the numeric loopback URL, but browser local/loopback permission and enterprise policies may block it. The app reports this and offers retry, fallback pairing and the local web app; it never bypasses browser permissions or changes security flags. Older browser preflight uses the restricted Private-Network response. See [Chrome local network access guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access) and [MDN loopback/mixed-content guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content). A fallback code cannot override a browser network block.
