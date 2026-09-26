import { useState } from "react";
import { emptySlot, slotIds } from "../shared/library";
import { SceneWidget } from "./SceneWidget";
import { initialState, type Snapshot } from "../shared/model";
export function SceneProof() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => {
    const state = initialState();
    state.onboarded = true;
    return {
      state,
      blockers: [],
      error: null,
      recovered: false,
      undoTimerUntil: null,
    };
  });
  return (
    <>
      <p style={{ background: "#fff", color: "#111", margin: 0 }}>
        Isolated visual fixture — no personal data
      </p>
      <label style={{ color: "#111", background: "#fff" }}>
        Fixture size
        <select
          value={snapshot.state.settings.scale}
          onChange={(e) =>
            setSnapshot((s) => ({
              ...s,
              state: {
                ...s.state,
                settings: {
                  ...s.state.settings,
                  scale: e.target.value as "small" | "medium" | "large",
                },
              },
            }))
          }
        >
          <option>small</option>
          <option>medium</option>
          <option>large</option>
        </select>
      </label>
      <button
        onClick={() =>
          setSnapshot((s) => {
            const next = structuredClone(s);
            const assets = [
              "blue-cat",
              "spiked-ball",
              "white-sports-car",
              "soda-blaster",
              "energy-canister",
            ];
            slotIds.forEach(
              (id, i) =>
                (next.state.settings.charms!.slots[id] = emptySlot(assets[i])),
            );
            return next;
          })
        }
      >
        Fixture seven charms
      </button>
      <button onClick={() => window.dispatchEvent(new Event("fixture-gust"))}>
        Fixture gentle gust
      </button>
      <SceneWidget
        snapshot={snapshot}
        send={async (type, data) => {
          const next = structuredClone(snapshot);
          if (type === "water.add") {
            const id = crypto.randomUUID();
            next.undoWater = { id, until: Date.now() + 30000 };
            next.state.drinks.push({
              id,
              ml: data?.ml as 350 | 1000,
              at: new Date().toISOString(),
              date: next.state.reminderDate,
              timezone: "UTC",
            });
          }
          if (type === "water.delete") {
            next.state.drinks = next.state.drinks.filter(
              (d) => d.id !== data?.itemId,
            );
            next.undoWater = null;
          }
          setSnapshot(next);
          return next;
        }}
      />
    </>
  );
}
