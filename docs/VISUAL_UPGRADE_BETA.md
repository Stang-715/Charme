# Visual upgrade beta — 23 September 2026

## Implemented

- Shared Three.js scene with generated Magnific model geometry, studio reflections, material-specific shading, forward-facing duck, separate glass/cap/liquid rendering, and volume-calibrated hydration level.
- Four new Magnific components: bottle shell, liquid volume, surface and single chain link. Provenance is recorded in the manifest and upgrade-provenance.json. The bottle/link feasibility fixture was visually inspected at empty, 20%, 60% and full.
- Rapier 3D joints, generated links, collision proxies, moon-like gravity, pointer gusts, damping, fixed hoop and bounded scene recovery. Stop motion and gentle gust controls are available.
- Beta layout editor with per-instance scale, link count, selection from list/preview, Apply/Cancel/reset, revision conflict rejection, and native live preview. Physics and ordinary charm activation are disabled while editing.
- Internal bottle progress label; exact milliliter records remain authoritative. Default 350 mL against 1.75 L shows 1/5. Rounded liquid geometry uses a measured 100-slice volume-to-height calibration.
- Native Controls panel, non-drag positioning, accessible timer state, named progress, popover focus/Escape, immediate OS reduced-motion response, and graphics recovery actions.
- Note-save acknowledgement preserves newer text; close/quit and navigation flush note writers and refuse unsaved layout abandonment. Settings drafts detect concurrent changes. Connection status is distinct from save status.
- Content-based build identifier in Settings and pre-upgrade backup when adding appearance defaults.

## Evidence

- 22 automated tests passed, including stale appearance apply, stale settings edits, liquid calibration, and acknowledgement of older note saves.
- TypeScript and production build passed; unsigned arm64 app packaging passed.
- Native app was relaunched with the shared scene. An initial physics instability was identified, corrected, and rechecked in the isolated browser fixture.
- Browser screenshot confirmed forward-facing duck, chrome hoop, generated chains/notebook, glass bottle, and internal first-serving label.
- Layout changed to 110% and the service returned “Layout saved.”
- axe WCAG-tag scans reported zero violations for Settings, layout, Today, empty Tasks/Notes, Controls and expanded drink options. Contrast has incomplete/manual-review items. These results are not comprehensive accessibility certification.
- Renderer frame counter remained at 119 with settled=true across two separate observations; timer snapshots no longer trigger 3D redraws.

## Known limitations and remaining acceptance

This remains a beta; the full release gate has not passed.

- Conservative rest-pose overlap rejection and viewport bounds are implemented and tested, including default optional slots. Exhaustive visual testing of every scale/decoration combination remains pending.
- Long names widen the generated tag backing using a grapheme-count threshold. Pixel-measured fitting and visual review of all 24-grapheme/emoji combinations remain pending.
- Physics includes a 12-second settling deadline and bounded recovery, so it is intentionally stylized. Large repeated impulses, multiple optional charms and the full native pointer cancellation matrix need extended testing.
- Final native restart/build-ID verification, full keyboard/VoiceOver journeys, 200% text enlargement, multi-monitor changes and contrast against patterned desktops still require acceptance checks.
- Frame-time and long-duration memory benchmarks have not been completed. No 60 fps or leak-free claim is made.
- Error-state axe scans, populated-note conflict UI tests, and complete native save-failure/quit tests remain outstanding.
- Task inline drafts do not yet have the same full close-guard handling as notes.
- Asset redistribution, signing/notarization, app icon and GitHub publication remain release gates.

## Use

Open Controls → Beta layout editor (or Dashboard → Layout). Apply commits the preview; Cancel returns to saved values. Source: npm ci, npm test, npm run build, npm run package.

Development-only visual fixtures are ?view=asset-proof and ?view=scene-proof; neither reads personal state. Add ?audit=1 to an authenticated dashboard view to expose the explicit accessibility audit control. Do not use fixture interactions as evidence of service persistence.
