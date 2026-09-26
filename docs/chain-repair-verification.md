# Charme chain / Undo repair

Build 6c92d2a46916 — unsigned Apple Silicon beta, 2026-09-24T06:58:31.705Z.

## Changes
- Chain attachments now sit on the hoop rim and track hoop scaling.
- A reach constraint prevents dragging a charm beyond its available chain. Generated link instances render from a connected endpoint path, rather than exposing transient stretched physics joints. No replacement model geometry was constructed.
- Existing gust strength, damping and orientation recovery remain. Endpoints follow the charm's rotated attachment point.
- Undo uses a 14-pixel SVG inside a fixed 24×24 logical-pixel button, positioned below the bottle. It no longer relies on a font glyph. Duplicate in-flight Undo requests are guarded; failures retain the offer instead of pretending success.
- Duck, Car and Name tag are explicit toggle choices. Clicking the selected choice deselects it; a separate Deselect charm button is also available. Apply saves, Cancel restores the prior assignment.
- Corrected the old Settings text to say five optional slots.

## Evidence
- 41 tests passed. New deterministic randomized coverage checks 2,000 three-dimensional endpoint configurations, exact chain endpoints, maximum span per generated link, finite coordinates and hoop-scale anchors.
- Production TypeScript/build and Apple Silicon packaging passed.
- Native core repair build 5311d64ba973 was launched, its Settings ID verified, and its connected rest layout inspected.
- Native Car selection and deselection both worked. The test draft was discarded and the original duck assignment restored; no test drinks were added to personal history.
- Isolated browser fixture: Undo measured approximately 24×24 logical pixels, SVG approximately 14 pixels; a test drink went from 350 mL back to zero after Undo. Screenshot showed the compact icon below the bottle.
- Isolated browser drag: charm rotated toward the hoop while its generated-link chain remained connected.
- Final build 6c92d2a46916 differs from the natively inspected repair only by correcting the Settings slot-count label. Launch was requested, but final native inspection timed out. Verify the final build ID in Settings if using the archive.

## Limits
This is not a full accessibility/performance certification. All imported geometry and arbitrary high-energy sequences have not been exhaustively tested. Visible links are positioned along a bounded connected path while physics drives the charm; they do not directly display transient solver errors.

To use: quit an older copy, extract Charme-chain-repair-arm64.zip, open Charme.app. In Charms select an optional slot, toggle Car or another charm, and Apply. Cancel leaves the saved layout unchanged.
