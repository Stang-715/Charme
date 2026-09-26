# Charme seven-charm repair beta

Build **8a767bdb3aee**, version 0.1.0, built 2026-09-23T16:25:42.171Z.
Unsigned macOS Apple Silicon preview. Native release acceptance is pending.

## Changes

- Seven hanging charms: fixed bottle/notebook and five independent optional slots. Empty slots have no model or chain. Imported GLBs may be reused or replaced independently.
- Add charm cards, active count, a live full-layout preview, selected-model preview, orientation/attachment controls, size and chain controls, and sticky Apply/Cancel actions.
- Editable name tags with independent text (24 grapheme limit), neon color, and neon/metal lettering. Text is a dynamic interface treatment on the existing generated backing. It is not newly generated extruded letter geometry matching the reference photograph.
- Explicit WebGL context release on scene replacement, disposed-scene error guards, and cleared graphics errors when rebuilding. This addresses a context-exhaustion risk found in code; the exact native failure in the user's screenshot has not been reproduced with diagnostics.
- Native windows load bundled resources from the existing loopback-only application server, avoiding file-origin worker restrictions. Existing sandbox/context isolation, navigation blocking, authenticated API and sender checks remain; IPC additionally verifies the exact loopback origin.
- Worker startup exceptions report a preview error. Automatic tether placement now finds a surface point near the top center rather than an arbitrary highest vertex. Legacy default attachment points are repaired in the editor draft, requiring Apply.
- Schema-three migration and version-two appearance/library data add slots D/E without overwriting existing assignments or scales. Migration creates a recovery backup. Older clients cannot apply an old three-slot library. Earlier beta executables must not be used to edit the upgraded data.
- The larger browsable charm catalog remains deferred, as requested. This version includes bundled choices plus the local uploaded-file list.

## Verification

- **40 tests passed, 0 failed.** Includes data migrations, seven-charm assignments, independent names, import validation, authenticated asset routes, archive restore, concurrent revision checks, hydration/timer/notes regressions, and explicit GPU context cleanup.
- TypeScript, production build and unsigned Apple Silicon packaging passed.
- Browser: full arrangement and model preview rendered; neon NOVA and metal MOON tags saved independently; all seven positions were populated and persisted after reload.
- Browser: a car's previous off-center automatic tether caused clipping. The corrected surface attachment passed layout validation and saved successfully.
- Accessibility scan of the tested name-tag editor state: **zero violations, 26 passes**. Color contrast and aria-prohibited-attr checks included incomplete results requiring manual review. This is not a conformance certification.
- GPU cleanup is regression-tested; sustained GPU memory measurement and context-exhaustion stress on native macOS are not yet complete.

## Native verification blocker

Computer Use first timed out inspecting Charme, then explicitly reported that the Mac was locked and could not be automatically unlocked. Native launch/build identification, file-origin-to-loopback behavior, VoiceOver, native click-through and lifecycle checks remain unverified. Browser evidence does not prove the running native copy was updated.

## Open the repair

Unlock the Mac. Quit the older Charme using its tray menu or app Quit command so edits are flushed. Extract `Charme-seven-charms-beta-arm64.zip` and open the extracted Charme.app. In Settings, verify build **8a767bdb3aee**. Use Charms to add a model or name tag, inspect the live preview, and Apply.

Existing timer, tasks, notes and water history are retained. Managed backups and imported assets remain in the application data directory. Keep a full `.charme` export when transferring data. The application is unsigned and has not been published to GitHub.
