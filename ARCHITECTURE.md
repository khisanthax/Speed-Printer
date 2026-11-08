# Architecture

## Runtime boundary

`src/main.ts` renders the approved fixed desktop shell. Vite builds a static TypeScript client for GitHub Pages. `src/domain.ts` owns preset validation, inheritance, unit formatting, tuning ranges and demo data. The three settings panels share identical rows and scroll offsets. Printer photos are displayed from the exact approved reference asset through CSS positioning; no inferred hardware specifications are added.

The browser calls `helper/server.py` over authenticated loopback HTTP. Native dialogs mediate profile reads, model selection and installation. The helper uses Python's standard library at runtime; PyInstaller produces an optional Windows EXE. Orca is a separately installed dependency, never bundled. Slicing jobs are serialized on one worker to bound resource use; up to four jobs can be outstanding. Results remain session-local.

## Contracts

- `GET /health`: helper version and executable availability.
- `POST /profiles {chooseRoot?}`: permission-gated JSON discovery; returns named presets.
- `POST /model {}`: native STL/3MF picker; returns opaque session ID and filename, never a browser-selected filesystem path.
- `POST /slice {bundle,model}`: validates and flattens the selected machine/process/filament, then returns a job ID.
- `GET /jobs/:id`: pending, running, complete/result or failed/error.
- `POST /analyze {bundle,target,model,keys}`: 1–8 one-at-a-time substitutions plus cumulative ranked substitutions.
- `POST /install {bundle,name}`: exact validated-settings requirement, native account directory choice and confirmation, exclusive create of three renamed presets.
- `POST /history {url,apiKey?}`: fixed read-only Moonraker `/server/history/list?limit=100&order=desc`.
- `POST /limits {url,apiKey?}`: fixed read-only `/printer/objects/query?toolhead&configfile`.

Every endpoint requires an exact allowed Origin, `Host: 127.0.0.1:8377` and a matching session bearer token. Preflight requires Host/Origin but not the token. No wildcard CORS or cookie authentication is used. Browser token state and Moonraker keys are in memory. The browser's platform local-network policy may require local use of the web app.

## Slicing provenance

`helper/core.py` invokes Orca with argument arrays: common input, `--load-settings machine.json;process.json`, `--load-filaments filament.json`, `--arrange 1`, `--slice 0`, `--outputdir`, and `--export-3mf`. Temporary directories isolate every slice. Nonzero exit, absent G-code, missing normal-mode time or multiple plates are failures. The result contains SHA-256 model/settings hashes and a timestamp. Cache identity also includes engine path, file size and modification time.

The client increments a generation counter when input changes and ignores older asynchronous completions. Adjustments debounce 650 ms; last estimates remain marked stale. Source metrics come exclusively from G-code comments. Missing breakdowns remain unavailable. Installation validation is session-local and must match the flattened bundle hash exactly.

## Controlled experiments

For each selected key, replace only its value with the target value and measure a real slice. Rank seconds saved against the baseline, then apply the ranked settings cumulatively and re-slice after each. Conditional gains show the effect after prior changes; the interaction residual is combined improvement minus the sum of isolated improvements. This detects interactions along one chosen path without claiming a full factorial study. No numerical search bypasses flow or machine limits. Quality-affecting controls are explicit choices.

## Persistence and installation

Only experiments persist in browser localStorage. Pairing credentials, Moonraker data and model IDs do not. Exports contain three flattened JSON presets. Installation creates `machine/<new-name>.json`, `process/<new-name>.json` and `filament/<new-name>.json` below the locally selected account folder. It updates names/settings IDs and custom-user markers. Existing paths fail; partial creates roll back. Orca should be closed during installation and restarted afterward. No original profile is modified.

## Testing and operational limits

Unit tests cover recursive inheritance errors, percentage/array preservation, parameter constraints, G-code provenance, interaction math, installation rollback, auth/Host/Origin checks and restricted Moonraker requests. Browser tests cover the three-column layout, synchronized scrolling, empty/pending summaries, saved experiments and missing history metadata. CI builds an unsigned helper artifact and deploys static hosting.

Physical printer safety, actual vs estimated calibration and Orca GUI account discovery require local hardware validation. Moonraker history does not establish original settings or feature timing. See the logbook for observed engine compatibility and end-to-end evidence.
