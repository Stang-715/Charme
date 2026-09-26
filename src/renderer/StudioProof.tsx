import { useState } from "react";
import { CharmManager } from "./CharmManager";
import { DialogHost } from "./Dialog";
import { AccessibilityAudit } from "./AccessibilityAudit";
import { initialState, type Snapshot } from "../shared/model";
import { validateLibrary } from "../shared/library";
import { validateLayoutEnvelope } from "../shared/appearance";
/** Isolated interaction fixture. Never connects to the user's state service. */
export function StudioProof() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    state: initialState(),
    blockers: [],
    error: null,
    recovered: false,
    undoTimerUntil: null,
  }));
  const [theme, setTheme] = useState("light");
  return (
    <>
      <DialogHost />
      <main className="dashboard" data-fixture="studio">
        <p>Isolated Collector Studio fixture · no personal data</p>
        <button
          onClick={() => {
            const next = theme === "light" ? "dark" : "light";
            setTheme(next);
            document.documentElement.dataset.theme = next;
          }}
        >
          Switch theme
        </button>
        <CharmManager
          snapshot={snapshot}
          send={async (type, data, id) => {
            const next = structuredClone(snapshot);
            if (next.state.processed.includes(id!)) return next;
            if (type !== "charms.save")
              throw Error("This fixture only saves arrangements in memory.");
            next.state.settings.charms = structuredClone(
              data!.library,
            ) as typeof next.state.settings.charms;
            next.state.settings.appearance = structuredClone(
              data!.appearance,
            ) as typeof next.state.settings.appearance;
            validateLibrary(next.state.settings.charms!);
            validateLayoutEnvelope(
              next.state.settings.appearance!,
              next.state.settings,
            );
            next.state.settings.charms!.revision++;
            next.state.settings.appearance!.revision++;
            next.state.processed.push(id!);
            setSnapshot(next);
            return next;
          }}
        />
        <AccessibilityAudit />
      </main>
    </>
  );
}
