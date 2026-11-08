# Speed Printer engineering log

Read this file before continuing work. Never commit private profiles, credentials, printer endpoints, or print history.

## 2026-11-08 — Milestone 1: foundation
- Created public repository https://github.com/khisanthax/Speed-Printer in the authenticated account.
- Retrieved exact approved Drive image 1RZBp9HlpVcijxWUOoHDI_KYWjTZZ09Gv using the connector; inspected the image locally (ignored `.local/mockup.png`).
- Workspace was empty except Git. OrcaSlicer is installed locally; no private user profiles have been read.
- Decision: lightweight TypeScript/Vite browser client and Python standard-library Windows companion. GitHub Pages provides free static hosting; all slicing and printer history stay on the user's PC.
- Approved layout: fixed desktop sidebar, three bordered columns with equal-height profile, synchronized settings, and summary sections.
- Next: implement comparison domain, UI, authenticated helper, tests and CI; verify actual installed Orca CLI before claiming estimates.

## 2026-11-08 — Milestones 2–3: approved UI and comparison
- Implemented approved blue/green/purple three-column structure, equal-height sections, fixed desktop sidebar, aligned rows and synchronized internal scrolling. Uses printer reference imagery from the approved asset.
- Added JSON imports, named machine/process/filament selection, recursive inheritance, missing-parent/cycle errors, difference highlighting, firmware-controlled acceleration labels, and missing-value states.
- Browser tests passed for layout, linked scrolling, pending summaries, browser-local preset persistence and demo history missing data. Visual screenshot inspection found a grid overflow; fixed min-height and reverified at 1672 × 941.
- Build and four TypeScript domain tests pass. Nine Python integration/security tests pass.

## 2026-11-08 — Milestones 4–7: local integration implemented; validation in progress
- Added serialized actual Orca CLI jobs, G-code-only estimate parsing, model/settings provenance hashes, debounced tuning with stale-result suppression, controlled isolated and cumulative impact experiments.
- Added exact-slice validation before new preset installation, native local confirmation/account selection, exclusive creation and partial-failure rollback. Browser preset save/export provides manual fallback.
- Added read-only Moonraker history and configured/current limits, explicit missing metadata, completed-only estimate error, model/conditions labels and demo fixtures. No printer connections or private history have been accessed.
- Security: loopback-only server, exact Host/Origin checks, session bearer auth, bounded bodies, native path selection, no shell invocation, post-processing rejection, fixed read-only Moonraker routes.
- Engine check revealed current Orca 2.5 system presets use binary `.opc` caches rather than JSON; do not treat these as ZIP bundles. Investigating compatibility and inheritance namespaces before claiming full installed-profile discovery.
- Downloaded official portable Orca builds into ignored local storage for independent validation. `--help` exits without stdout on this Windows build; actual slice output will be the verification criterion.
- Next: finish real CLI smoke test, namespace-aware imports, UI/API end-to-end checks, packaging and free GitHub Pages deployment.

## 2026-11-08 — Milestones 4–8: verified integration and deployment
- Added bounded `.opc` cache format-2 decoding using upstream wire-layout documentation; verified all 14,280 bundled presets in official Orca 2.5.0 portable, with no cache warnings. Installed Orca alpha bundled 13,963 presets, also decoded without warnings. Vendor-scoped inheritance and ordered includes prevent cross-vendor base-name collisions.
- Real CLI tests found and fixed Windows export path handling and duplicate standalone/archive G-code collection. Official 2.3.2 generated 618 seconds for an original 20 mm cube; official 2.5.0 portable generated 619 seconds; the installed alpha generated 613 seconds. These are distinct engine/profile versions, not interchangeable benchmark claims. Filament output was 3.61 g; all figures came from actual G-code.
- `helper/smoke_orca.py` verifies public bundled SV08 presets, real controlled re-slicing, new preset creation in a temporary directory, and re-slicing of the newly named presets. Installed alpha baseline 613 s; outer-wall substitution 612 s; renamed presets preserved 613 s. No actual user profile directory was modified.
- Configured Mercury SSH alias was available; read-only inspection identified two Moonraker instances. Verified job-history response fields and toolhead limit fields against both instances, without saving or publishing private endpoints, filenames, configurations or history.
- Print Lab now requires explicit selection of completed jobs across printers and asserted equivalent model/conditions before displaying cohort means. Failed/cancelled jobs and missing estimates are excluded appropriately; history lists are explicitly unfiltered.
- Added numeric-IP-only LAN access to avoid DNS rebinding, executable-plugin rejection, structured 3MF config screening, immutable model snapshots, engine-DLL-aware cache identity and bounded in-memory job/result caches.
- Created CI for TypeScript tests/build, Chromium tests, Windows Python tests, and PyInstaller packaging. Initial CI and GitHub Pages workflows succeeded. Downloaded the CI Windows EXE and verified startup plus authenticated health; session token was never saved or printed in tool output.
- Enabled free public GitHub Pages at https://khisanthax.github.io/Speed-Printer/. No payment, hosting secrets or printer credentials required.
- Browser integration testing caught summary buttons losing handlers after refresh; fixed and added regression coverage. Exact bundle/model matching now suppresses stale tuning results without discarding unrelated baseline results.
- Next: finish opt-in actual browser-to-engine verification, verify final deployment/assets and release the packaged helper. Physical print safety and Orca GUI/account pickup remain user/hardware validation, not claimed by slicing tests.

## 2026-11-08 — Milestone 9: end-to-end verification
- Opt-in Chromium test passed through the actual browser UI → session-authenticated helper → public bundled SV08 profile import (including `.opc` inheritance) → model selection → installed Orca slicing → displayed baseline and tuning summaries. It used an original generated cube and a test-only public-profile fixture server; no user profiles or printer actions were involved.
- Added explicit Windows exclusive socket ownership after the packaged one-file bootstrap left its child process alive during test cleanup. Cleaned up only the test artifact process; production helpers now reject competing binds. Test-only lifecycle cleanup is separate from production behavior.
- Local tests currently pass: five TypeScript tests, three ordinary Chromium journeys and the opt-in real-engine Chromium journey; Python suite includes cache, inheritance, installer, auth, CORS, SSRF and exclusive-bind checks. Final CI/readback and release artifact verification follow this commit.
- Remaining local acceptance: select an actual Orca user account directory and confirm GUI pickup of newly installed presets; verify hardware/quality limits through deliberate physical tests; connect SV08 and any additional Moonraker host when available. These are not simulated as completed hardware tests.
- Integration commit `99ece91` passed both hosted deployment and Test and package CI. Live public URL returned HTTP 200; Chromium verified asset loading, all three desktop columns within the viewport, retry control, navigation and demo Print Lab without runtime errors.
- Final refinements: only relevant Klipper limits are returned to the browser, added embedded 3MF execution rejection regression test, and made manual exports one explicit download per file to avoid browser multiple-download blocking. Fourteen Python tests pass locally. Rebuilding the final helper/release artifacts after these changes.

## 2026-11-08 — Delivery complete
- Application release commit `88abe94` passed Test and package CI (run `42511117125`) and GitHub Pages deployment (run `42511117223`). Downloaded that exact CI Windows helper, verified authenticated startup, and terminated the complete test process tree afterward.
- Published public release https://github.com/khisanthax/Speed-Printer/releases/tag/v0.1.0 with the unsigned Windows EXE and SHA-256 file. GitHub's uploaded asset digest matches the locally tested binary: `f292c1c0265b591d00156cbb71aa11ce7a03a7c3d1103f55c148f49614bd626f`.
- Reverified https://khisanthax.github.io/Speed-Printer/ in Chromium: HTTP 200, assets and JS execution, approved three columns fitting 1672 × 941, navigation, tuning retry and demo Print Lab all passed without runtime errors.
- Final checks: build, five TypeScript tests, fourteen Python tests, three standard browser journeys and a separate opt-in actual browser/Orca journey passed. Standard CI skips the opt-in test when Orca is absent; it was run successfully on this PC. Manual-export browser regression also downloaded and parsed all three renamed JSON files.
- Public tracked files were checked for actual credential/private-key patterns and known private printer endpoint; none were present. No user Orca profile was overwritten, no Home Assistant changes were made, and no printer control or print command was issued.
- Milestones 1–9 delivered: public project, approved UI, comparison/import, actual slicing, controlled tuning, preset persistence/install, Print Lab, tests/security/Windows packaging/deployment, and end-to-end documentation.
- Next user acceptance: install into the intended Orca account through its native confirmation flow and verify GUI selection; connect the SV08 Moonraker origin and future printers; conduct physical quality/safety tests and matched-job calibration. Slicing and read-only history do not prove these hardware outcomes.

## 2026-11-08 — Personal profile loading follow-up
- User explicitly requested starting the Windows helper, pairing the deployed app and loading their two printer profile bundles. Started the packaged helper and paired the deployed page; token remained in memory only.
- Real saved user presets omit `type`, so discovery now infers kind from the containing machine/process/filament directory. Added an original synthetic fixture regression test.
- Older saved filament presets may inherit former system names. Both resolvers now honor upstream `renamed_from` aliases when no exact parent exists, with regression coverage.
- Native confirmation dialogs had an invisible owner window which automation could not target. The helper now displays a small titled owner while awaiting local confirmation, preserving explicit permission rather than bypassing it.
- Six TypeScript tests, sixteen Python tests and the production build pass. Rebuilt the Windows helper locally; deploying the compatibility fixes before completing personal imports. Private presets and connection information remain outside tracked files.
- Compatibility commit `b4e0769` passed both CI and Pages deployment. The automation launch lacked APPDATA; relaunched only the task's helper with the correct Windows profile-directory environment, then paired the deployed app without storing or revealing the token.
- User confirmed the native profile-read permission. Loaded both personal machine/process/filament bundles using Orca's remembered per-printer selections and verified both columns show Imported profile, the page reports effective profiles imported, and the local helper is paired. Left the comparison tab open for the user.
- No personal preset files were modified or copied into tracked files. No model was selected and no slice or printer command was started. The remembered material selections differ; use matching model/material conditions before attributing estimated-time differences to printer performance.

## 2026-11-08 — Requested PETG slicing comparison
- At the user's request, retained the current printer's PETG bundle and selected the target printer's saved PETG bundle, then ran real local slices of the same requested project.
- The original project failed Orca validation because an inactive raft expansion used legacy value -1. Created an ignored local working copy normalizing that field to 0 after verifying raft layers are disabled. Verified every geometry/placement/archive entry remained byte-identical except that single project-settings value; the original download was not modified.
- Inspected source scope: two original plates, 24 total parts. Verified generated G-code contains 24 object definitions after Orca auto-arrangement onto one plate. Results therefore represent the complete project, not one part.
- Both app summaries show Verified local slice, G-code normal-mode estimates and measured filament totals. Left the paired comparison open. Personal results and screenshots remain local and are not committed.
- Comparison qualification: both use PETG and 0.20 mm processes, but supports remain disabled in the current process and enabled in the target process; their calibrated filament/process settings also differ. No physical print or printer control command was issued.
- Fixed inherited rename-alias metadata leaking onto child presets, which could cause false cycles when re-resolving an already effective user preset. Regression test added to the synthetic alias fixture. Six TypeScript and sixteen Python tests pass.
