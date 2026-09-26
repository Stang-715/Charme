# Current beta status

See [Visual upgrade beta](VISUAL_UPGRADE_BETA.md) for the latest implementation and evidence. The historical report below describes the earlier preview.

# Implementation status — 23 September 2026

The user's revised plan remains the product contract. This is a development preview, not a completed release.

## Verified

- 15 automated service and HTTP tests passed: timer boundaries and overlapping blockers, manual pause, reset/Undo, clean and crash recovery, duplicate commands, water overshoot, midnight history, reminders, unsupported schema preservation, failed writes, restore revisions and managed-backup reset.
- TypeScript checks and production build passed.
- Unsigned Apple Silicon application packaging passed using Electron 44.4.3.
- Native application launched through Computer Use after access became available.
- Browser visual review confirmed the hoop opening and timer, textured bottle, localized water highlight, generated notebook, chains, car, duck and name-tag backing.
- Isolated preview profile: logging 350 mL updated the exact total and cleared the reminder; task create/complete survived reload; multiline note containing Hindi, accented text and emoji autosaved and survived reload.

## Changes since the previous preview

- All seven 3D models are generated through Magnific and bundled offline. IDs are recorded in assets/models/provenance.json and public/models/manifest.json.
- Corrected model orientation and blob texture CSP loading; added studio illumination and material adjustments without constructing model geometry.
- Added generated chain assemblies, notebook, car selection, dynamic name lettering and two manifest-backed optional decoration slots.
- Added mesh hit testing that accounts for CSS swing/scale transforms, pointer-capture tracking, graphics retry, and cleanup of late-arriving models/textures.
- Native notebook/settings navigation reuses the existing renderer instead of reloading and discarding its in-memory drafts.

## Outstanding acceptance work

1. Complete native click-through, focus, dragging, pointer cancellation, all scale presets, lock/sleep/session combinations and monitor-removal tests. The current native inspection attempt is blocked because the Mac is locked; Computer Use requires manual unlock.
2. Refine and approve final attachment alignment, optional-slot placement, long-name legibility and light/dark desktop appearance. Assets are candidates, not user-approved final artwork.
3. Finish accessible whole-widget graphics recovery; current model failures have a message and Retry, while ordinary controls remain available.
4. Exercise note conflict/deletion and failed-save flows through multiple real UI clients; service-level cases already pass. Verify native panel-close draft protection.
5. Add historical daily summaries and consume full attachment/motion metadata for developer-added charms.
6. Run a real-duration 45/15 cycle and measure frame time, settled rendering and memory trends on the development Mac. No measured 60 fps or leak-free claim is made.
7. Complete icon, release CI, minimum macOS support verification, asset redistribution review, clean install/upgrade checks and signing/notarization (or retain unsigned-preview labeling).
8. GitHub publication remains pending authentication. No source or binary has been published.

## Environment and reproducibility

macOS on Apple Silicon (arm64); exact CPU/RAM measurement was blocked by sandbox restrictions. Dependencies are pinned. Run `npm ci`, `npm test`, `npm run build`, `npm run package`. The application uses one native state owner and an authenticated loopback dashboard. Browser-only preview data is isolated at /private/tmp/charme-preview-data.

The packaged preview is unsigned and uses the default Electron icon. Do not treat this snapshot as release-ready or as proof of every acceptance scenario.
