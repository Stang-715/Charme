# Charme compact beta — implementation and verification

Build **85228d0e2f21**, version 0.1.0, built 2026-09-23T13:20:04.376Z.
Target: unsigned macOS Apple Silicon development preview. **Not release-approved.**
Development machine: Apple M5, 16 GiB memory, macOS Darwin 25.6.0, arm64.

## Implemented

- Small 180×268, Medium 270×401, Large 360×535 logical-pixel presets; independently sized timer controls and tight hoop/glass fit.
- Bottle has visual hydration only. Drink options moved to Controls. Shared 30-second Undo follows the bottle and deletes its exact entry across clients.
- Zero downward gravity, damped pose recovery, pointer velocity impulses, rotation, kinematic holding during clicks, Stop versus Reset pose, reduced-motion handling, and render-on-demand.
- Fixed bottle/notebook plus three optional slots; bundled or uploaded GLBs, independent orientation/attachment/size/chain adjustments, atomic Apply with both revision checks, Cancel, and library management.
- Outer optional chains route around the fixed charms using unchanged generated links. Collision groups exclude links from their own charm and other links while permitting contact with other charms.
- Disposable worker-based GLB decode/render preview with OffscreenCanvas and a 30-second termination timeout; no main-thread fallback. Browser preview verified; native file loading and timeout fault injection remain unverified.
- Static embedded GLB validation, resource limits, content-hash storage, authenticated reads, combined scene budgets, and calculated imported bounds.
- Schema-two migration with pre-upgrade backups; asset-inclusive `.charme` archive export/restore and legacy JSON restore; failed-write cleanup and stale-client invalidation.
- Recovery layout without overwriting saved sizes; missing optional assets expose a repair control while preserving core controls.

## Passed evidence

- **37 automated tests passed; 0 failed.** Includes existing timer/notes/storage regressions and new migration, shared Undo, malformed/external-resource GLB rejection, duplicate import, import rollback, combined budgets, authenticated upload/read, archive integrity, restore, idle scheduling, and collision-filter tests.
- TypeScript check, Vite/Electron build, and Apple Silicon packaging succeeded.
- Browser inspection: tight glass fit; no bottle text or bottom strip; imported car preview, orientation controls, automatic surface attachment, Apply acknowledgment, and persistence after reload.
- Final editor check: imported car orientation changed to 90 degrees and scale to 95%; one Apply saved both and reload retained both. Attachment moved with the rotation. Final Manage charms axe scan: zero violations, 23 passes, contrast incomplete.
- Browser inspection: three optional slots assigned alongside bottle/notebook, with outer chains routed around them.
- Cross-client test: a drink logged in Controls appeared in widget progress/Undo; widget Undo returned both clients to the prior total.
- Measured Small digits: 18 px; timer target approximately 48×24 logical pixels. Undo approximately 24×24 (minor browser floating-point rounding).
- Automated accessibility scans: no violations on tested Manage charms and Controls states. Contrast checks returned incomplete and require manual inspection.
- Controlled default-layout gust settled in **10.902 seconds**. Frame counter stayed at **705** across separated observations afterward. This is a browser measurement of one controlled scenario, not a general performance certification.

## Corrections found during verification

- Small digits initially inherited viewport sizing and exceeded the glass width; corrected to explicit preset typography.
- Default attachment could float above a wide imported car; preview now places it on a highest model vertex and disallows applying an off-surface point.
- Settling originally rescheduled itself through Stop, producing an idle render loop and misleading timing; removed and regression-tested.
- Optional long chains originally ran through the bottle/companion; changed their starting routes and added collision-filter tests.
- Asset metadata registration failure originally risked orphaning a new file; cleanup is now covered by a write-failure test.

## Outstanding work / release blockers

The full requested acceptance plan is **not complete**:

- Native inspection repeatedly timed out after the save-aware quit/relaunch attempt. The final package's build ID has not been verified in a running native Settings window. Do not assume the currently running app contains this final package.
- Full VoiceOver, native click-through/focus/drag capture, sleep/lock, monitor changes, 200% text enlargement, all preset/five-slot combinations, and wallpaper contrast checks remain unverified.
- Sustained frame-time, memory/GPU-resource trend, repeated fast-sweep stress, and arbitrary imported-model pose tests remain unverified. The 10.9-second result is not evidence for all layouts.
- Legacy name text is preserved in settings and the tag backing occupies a proper optional slot. Dynamic lettering fitting on reassigned tag backings still needs completion and verification; do not treat that earlier name-tag feature as fully preserved visually.
- Automated accessibility evidence covers the named screens/states only, not all error paths or native interactions. No WCAG or VoiceOver conformance claim is made.

## Opening and recovering

Quit the older Charme instance, extract `Charme-compact-beta-arm64.zip`, and open the extracted Charme.app. Only one instance owns the data. Use the tray for Controls, Manage charms, Layout, and position recovery. Verify Settings shows build **85228d0e2f21**.

Data remains under `~/Library/Application Support/charme`. Export a `.charme` backup before moving data between machines. Keep the managed assets directory alongside any internal JSON recovery records. Older releases must not overwrite schema-two state. User-created exports are not removed by Reset-all.

This package is unsigned, uses the default Electron icon, and has not been published to GitHub or distributed as a signed public release. Existing Magnific geometry was reused; no replacement model geometry was constructed.
