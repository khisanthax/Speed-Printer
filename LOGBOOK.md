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
