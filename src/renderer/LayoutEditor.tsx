import { slotIds } from "../shared/library";
import { registerWriter } from "./flush";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  defaultAppearance,
  instances,
  validateAppearance,
  validateLayoutEnvelope,
  type Appearance,
  type Instance,
} from "../shared/appearance";
import type { Snapshot } from "../shared/model";
import type { Send } from "./SceneWidget";
const Preview = lazy(() =>
  import("./SceneWidget").then((m) => ({ default: m.SceneWidget })),
);
export function LayoutEditor({
  snapshot,
  send,
}: {
  snapshot: Snapshot;
  send: Send;
}) {
  const saved = snapshot.state.settings.appearance ?? defaultAppearance();
  const [draft, setDraft] = useState<Appearance>(() => structuredClone(saved)),
    [selected, setSelected] = useState<Instance>("bottle"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const baseline = useRef(JSON.stringify(saved));
  const dirty = JSON.stringify(draft) !== baseline.current;
  const latest = useRef({ dirty, saved });
  latest.current = { dirty, saved };
  useEffect(
    () =>
      registerWriter(async () => {
        if (latest.current.dirty)
          throw Error("Apply or cancel your layout edits before closing.");
      }),
    [],
  );
  const reset = () => {
    setDraft(structuredClone(saved));
    baseline.current = JSON.stringify(saved);
    setMessage("Saved layout restored.");
  };
  useEffect(() => {
    try {
      validateLayoutEnvelope(draft, snapshot.state.settings);
      window.charme?.preview(draft);
    } catch {
      window.charme?.preview(saved);
    }
    return () => window.charme?.preview(null);
  }, [draft]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (
          !latest.current.dirty ||
          confirm("Discard unsaved layout changes?")
        ) {
          setDraft(structuredClone(latest.current.saved));
          baseline.current = JSON.stringify(latest.current.saved);
        }
      }
    };
    document.addEventListener("keydown", escape);
    const before = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      document.removeEventListener("keydown", escape);
      window.removeEventListener("beforeunload", before);
    };
  }, []);
  const update = (patch: Partial<Appearance>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMessage("Preview only — Apply to save.");
  };
  const scale = draft.scales[selected];
  let issue = "";
  try {
    validateLayoutEnvelope(draft, snapshot.state.settings);
  } catch (e) {
    issue = (e as Error).message;
  }
  return (
    <section>
      <h2>Beta layout editor</h2>
      <p>
        Physics and charm actions are paused during editing. Sizes are relative
        to the default layout.
      </p>
      <div className="layout-fields">
        <label>
          Selected attachment
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value as Instance)}
          >
            {instances
              .filter(
                (id) =>
                  id === "hoop" ||
                  id === "bottle" ||
                  id === "notebook" ||
                  (slotIds.includes(id as any) &&
                    snapshot.state.settings.charms?.slots[
                      id as "companion" | "extra0" | "extra1"
                    ]?.asset),
              )
              .map((id) => (
                <option key={id}>{id}</option>
              ))}
          </select>
        </label>
        <label>
          Size (%)
          <input
            type="number"
            min="50"
            max="150"
            step="1"
            value={Math.round(scale * 100)}
            onChange={(e) =>
              update({
                scales: {
                  ...draft.scales,
                  [selected]: Number(e.target.value) / 100,
                },
              })
            }
          />
        </label>
        <label>
          Size slider
          <input
            type="range"
            min="50"
            max="150"
            value={Math.round(scale * 100)}
            onChange={(e) =>
              update({
                scales: {
                  ...draft.scales,
                  [selected]: Number(e.target.value) / 100,
                },
              })
            }
          />
        </label>
        {selected !== "hoop" && (
          <label>
            Chain links
            <input
              type="number"
              min="0"
              max="20"
              step="1"
              value={draft.links[selected]}
              onChange={(e) =>
                update({
                  links: { ...draft.links, [selected]: Number(e.target.value) },
                })
              }
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={draft.motion}
            onChange={(e) => update({ motion: e.target.checked })}
          />{" "}
          Motion enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.wind}
            onChange={(e) => update({ wind: e.target.checked })}
          />{" "}
          Pointer wind
        </label>
        <label>
          Wind strength
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={draft.strength}
            onChange={(e) => update({ strength: Number(e.target.value) })}
          />
        </label>
      </div>
      {issue && <p role="alert">{issue}</p>}
      <p role="status">{message}</p>
      <div className="row">
        <button
          disabled={busy || !!issue || !dirty}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await send("appearance.save", {
                appearance: draft,
                revision: draft.revision,
              });
              const value = result.state.settings.appearance!;
              setDraft(value);
              baseline.current = JSON.stringify(value);
              setMessage("Layout saved.");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply
        </button>
        <button
          onClick={() => {
            if (!dirty || confirm("Discard unsaved layout changes?")) reset();
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const d = defaultAppearance();
            update({
              scales: { ...draft.scales, [selected]: d.scales[selected] },
              links: { ...draft.links, [selected]: d.links[selected] },
            });
          }}
        >
          Reset selected
        </button>
        <button
          onClick={() =>
            update({ ...defaultAppearance(), revision: draft.revision })
          }
        >
          Reset layout
        </button>
        <button onClick={reset}>Reload saved layout</button>
      </div>
      <div className="layout-preview">
        <Suspense fallback={<p>Loading preview…</p>}>
          <Preview
            snapshot={snapshot}
            send={send}
            appearance={issue ? saved : draft}
            editing
            onSelect={setSelected}
          />
        </Suspense>
      </div>
    </section>
  );
}
