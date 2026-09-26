> Latest: [Collector Studio preview and verification limits](docs/COLLECTOR_STUDIO_BETA.md), build cf6663decf35.

# Charme

A local-first floating desktop keychain for focus, water and small everyday tasks.

**Collector Studio development preview.**

[Open the public browser demo](https://stang-715.github.io/Charme/) · [Verification and remaining release gates](docs/COLLECTOR_STUDIO_BETA.md)

The browser demo uses isolated, temporary data. The macOS app provides local persistence and native desktop controls.

## Run from source

Requires Node.js 22.12+ and npm. macOS Apple Silicon is the initial target.

```sh
npm ci
npm start
```

The app opens a transparent desktop window. Use its tray menu to open the notebook, settings or authenticated localhost dashboard. First-run onboarding starts a 45-minute focus / 15-minute rest cycle.

```sh
npm test             # service and HTTP integration tests
npm run build        # TypeScript + renderer + Electron bundles
npm run package      # unpacked unsigned macOS app
npm run dist         # unsigned DMG and ZIP
```

If your development environment restricts cache writes, point npm and Electron caches at a writable directory. Do not change ownership of system folders to work around this.

## Implemented foundation

- One state owner for timer, hydration, tasks, notes and settings.
- Separate manual intent and sleep/lock/session blockers.
- Checkpoint recovery, atomic JSON writes and last-known-good backup.
- Exact 350 mL / 1 L logging against a configurable liter target.
- Task and note commands, revision conflict handling, autosave interface and draft preservation.
- Authenticated loopback dashboard with one-use launch tokens and live updates.
- Export, validated restore, and explicitly confirmed reset.
- Electron shell, tray, constrained preload, window position and scale preferences.
- Magnific-generated hoop, bottle, duck, chrome chain, notebook, car and tag; dynamic name text; pendulum motion.

## Still required before release

See [implementation status](docs/IMPLEMENTATION_STATUS.md). All seven generated models are integrated, including selectable car, notebook, name-tag backing and optional slots. Final attachment alignment, optional-slot layout, graphics recovery, native click-through and screen lifecycle still need acceptance testing. This preview does not claim reference-image fidelity.

## Local data

The application stores state under Electron's per-user application-data folder (normally `~/Library/Application Support/charme` in development). Use **Data folder** to find the actual directory. JSON files are not encrypted. No note content or account data is uploaded.

- `state.json`: settings, tasks, notes, water and focus history.
- `backup.json`: previous validated state.
- `checkpoint.json`: session-matched timer/reminder checkpoint.
- `window.json`: widget placement.
- `pre-restore-*.json`: recovery copy created before restore.
- `damaged-*.json`: preserved invalid data.

Export a backup before moving computers or uninstalling. Restore pauses the timer and invalidates old item revisions. Reset-all deletes managed backups as well as personal records; exported files elsewhere are untouched.

The dashboard is available only while Charme runs. Open it through the tray each app session. Old browser tabs cannot discover a new random port. Its token is not a cloud login.

## Assets and extensions

All model geometry must come through Magnific. Provenance is in `assets/models/provenance.json`; candidate manifests are in `public/models/manifest.json`. No runtime Magnific credentials are needed. Redistribution review remains a release gate. Do not assume generated assets are approved merely because they load.

Developer-added decorations use the versioned bundled manifest in public/models/manifest.json. It includes ID, local GLB path, orientation, provenance and attachment/motion metadata. Two optional slots select bundled decorations. Runtime downloads and executable plugins are deliberately unsupported. Attachment and motion metadata are not yet fully consumed by the shared layout.

## Verification

Automated tests cover lifecycle pauses, timer boundaries, crash/clean restart, mixed-volume water logging, duplicate requests, date rollover, note conflicts, restore revisions, failed writes and dashboard authorization. Browser checks confirmed water logging, task completion persistence, and multiline Unicode note autosave through reload. Native acceptance checks and a real-duration 45/15 cycle remain outstanding.

The unsigned development bundle has not been notarized. GitHub publication has not occurred.

## Beta appearance controls

Open Controls → Beta layout editor to resize each attachment, change link counts, and tune wind/motion. Apply persists the layout; Cancel discards the preview. The hoop remains fixed while generated chain links and charms share one physics scene. Bottle fill now represents daily hydration progress.

## Compact beta (September 2026)

The widget presets are 180×268, 270×401 and 360×535 logical pixels. The tray's Controls panel contains hydration amounts, history access, timer reset/Undo, positioning, and motion commands. Bottle progress has no visible numeric overlay; its 30-second Undo follows the bottle. The tray's Manage charms panel assigns three optional slots in addition to the fixed bottle and notebook. The beta layout editor controls instance scale and generated chain-link count.

Upload self-contained static GLB 2.0 models with embedded PNG/JPEG images. The import preview offers front orientation and a selectable attachment point. Imported animation, skinning, morph targets, Draco/Meshopt compression, and external resource URLs are rejected. Limits: 20 MB/file, 200,000 triangles, 100 primitives, 512 nodes, 4096-pixel textures, and 96 MiB estimated texture memory per asset. Combined active imported slots: 300,000 triangles, 150 primitives, 192 MiB textures. Managed imported bytes, including recovery copies, have a 250 MB cap.

Imported geometry remains unchanged; only instance transforms and rendering are applied. Approved bundled Magnific assets remain offline. Optional imported models are addressed by hash, authenticated separately from static bundled resources, and excluded from state snapshots and timer checkpoints.

Backups now use `.charme`: a versioned, length-delimited archive containing JSON state and hashed GLB data. This format does not extract filesystem paths, symlinks, or compressed entries. Legacy JSON restore remains supported. State schema 4 prevents older versions silently ignoring new catalog assignments. Pre-upgrade/pre-restore JSON records retain references to immutable model bytes under the managed `assets/` directory. Reset-all removes those managed files; user exports are never removed.

This is an unsigned development beta, not an accessibility-certified or release-approved build. See the accompanying verification report for test evidence and outstanding gates. Quit the older Charme instance before opening a newly extracted package; only one state owner can run at a time.
