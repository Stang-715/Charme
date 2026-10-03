# Collector Studio preview — 25 September 2026

Build: **cf6663decf35**, version 0.1.0, Apple Silicon / arm64. Unsigned development preview. Release acceptance is incomplete.

## Implemented

- Charcoal and warm ivory Collector Studio, system appearance with persistent override, unified hub navigation and remembered section.
- Seven hanging positions: fixed bottle and notebook plus independent A–E. Existing duck, orange car, editable neon/metal tags and uploads remain.
- Six Magnific-generated collection models: blue star cat, spiked tennis ball, white sports car, motorsport coupe, soda blaster and energy canister. A seventh generated model replaces the notebook with an embossed gear. All visible replacement model geometry came from Magnific.
- The six collection models received a second Magnific PBR pass. Embedded base-color, normal and metallic/roughness maps were reduced to 1024px without replacing geometry. Each uses approximately 16 MiB of decoded texture memory including mipmaps. Provenance and generation IDs are in the model manifest and assets/studio-pbr-generations.json.
- Gallery cards only preview. Explicit Add, Replace and Remove act on a named position. Repeated card clicks do not remove anything. Batch addition reviews its mapping to empty positions.
- Arrangement drafts, isolated model preview with orbit/zoom/reset buttons, calibrated defaults, numeric placement controls, invalid-draft errors, separate selected/all reset, revision-checked atomic Apply and guarded uncertain retries.
- File validation and preview precede Import to library. Import and arrangement Apply remain separate durable actions. Cancel invalidates stale validation/preview results. Duplicated bytes reuse an asset.
- In-app confirmation dialogs for arrangement edits and browser restore/reset. Note navigation attempts to flush drafts; failures retain the draft and expose recovery.
- Notebook click opens/focuses the hub; dragging does not activate it. Release must remain on the original picked object. Existing connected tether rendering, compact presets, 30-second water Undo and 10-second timer reset Undo are retained.
- Backed-up schema-four migration. Older builds must refuse schema four rather than overwrite new catalog assignments through an older backup.

## Passed evidence

- `npm run build`: TypeScript and renderer/main production builds pass.
- `npm test`: **46 passed, 0 failed**. Includes migrations, future-schema refusal, persistence failure, duplicate commands, concurrent revisions, shared hydration Undo, exact volumes, GLB validation, authenticated asset validation, archive restore and tether-path continuity stress coverage.
- Tests validate real generated GLBs, matching catalog resource metrics and combined optional-scene budgets.
- Isolated browser fixture: repeated selection previews without removal; explicit replacement stages only the selected position; Apply acknowledges Saved; calibrated cat and car previews render with embedded textures.
- Isolated widget fixture: Small bottle click adds exactly 350 mL; Undo removes it. Embossed notebook is visible. Seven occupied positions render at Small and Large with connected chains in observed frames; gentle gust also exercised. These are browser observations, not native focus or continuous-motion certification.
- Collector Studio light and dark axe scans: **0 violations, 27 passing rule categories**, with `aria-prohibited-attr` left for manual review. This does not establish WCAG conformance or cover every screen/error state.
- electron-builder produced an unsigned arm64 `.app`. Inspection of the packaged renderer confirms build **cf6663decf35** and all seven new GLBs are present.

## Unverified / remaining release gates

- Native launch verification was blocked: shell Electron launches were terminated by the execution environment, and native app-control launch attempts timed out. The current running user app was not replaced or confirmed to show this build. Package inspection is not native execution evidence.
- VoiceOver, full keyboard-only flows, native click-through/focus, display removal, lock/sleep/resume, all size/theme/wallpaper combinations, 200% text and genuine 420px viewport checks remain unverified. The browser viewport tool did not actually reach its requested 420px width.
- Complete save/cancel/conflict and stale preview UI fault injection, failed-note navigation in the native window, seven charms plus full water plus active Undo, and repeated context-loss/recovery need end-to-end testing.
- No measured frame-time or long-duration GPU/memory trend report. No instrumented proof of zero idle frames. Model preview currently reconstructs its isolated renderer when placement/name parameters change; resource disposal is implemented but sustained measurements remain required.
- Preview attachment marker positioning during camera orbit needs further polish. The first-use notebook help hint and imported-model thumbnail generation are not yet implemented (imports use a neutral placeholder).
- Native temporary preview ownership is intentionally limited to the single native hub. Browser clients edit through their inline arrangement preview and cannot take over the desktop preview.
- Generated lettering and branded markings are approximate; the models are not certified replicas. Public model redistribution rights remain unverified. The browser preview is public on GitHub Pages. Signing and notarization remain incomplete. The app still uses the default Electron application icon.

These limitations keep the formal release gate closed. This package is for review and continued native testing, not a claim that every interaction or accessibility scenario passed.

## Open and recover

Quit the old Charme from its tray before opening the extracted app. Open Settings and check build **cf6663decf35**. Existing user data remains in Electron's Charme user-data directory, normally `~/Library/Application Support/Charme`; pre-upgrade recovery copies are kept there. Export a `.charme` backup before returning to an older build: schema four deliberately prevents older builds from reading the newer state. Do not manually delete or overwrite the data directory to bypass that protection.

Source setup: `npm ci`, `npm run build`, `npm test`, then `npm start`. Use Node compatible with the committed lockfile. All accepted model and lighting resources are bundled for offline use. Fixture URLs `?view=studio-proof` and `?view=scene-proof` use isolated in-memory state and must not be mistaken for the actual user's saved data.
