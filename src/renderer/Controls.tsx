import { useRef, useState } from "react";
import { waterTotal, type Snapshot } from "../shared/model";
import type { Send } from "./SceneWidget";
import { action } from "./api";
export function Controls({
  snapshot,
  send,
}: {
  snapshot: Snapshot;
  send: Send;
}) {
  const s = snapshot.state,
    t = s.timer;
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = async (fn: () => Promise<unknown>, success = "Done.") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>Controls</h2>
      {error && <p role="alert">{error}</p>}
      <p role="status">{message}</p>
      <fieldset disabled={busy}>
        <legend>Timer</legend>
        <p>
          {t.phase} · {Math.ceil(t.remainingMs / 60000)} minutes remaining ·{" "}
          {snapshot.blockers.length
            ? "System paused"
            : t.intent
              ? "Running"
              : "Manually paused"}
        </p>
        <div className="row">
          <button
            onClick={() =>
              void run(() => send(t.intent ? "timer.pause" : "timer.resume"))
            }
          >
            {t.intent ? "Pause" : "Resume"} timer
          </button>
          <button
            onClick={() =>
              void run(
                () => send("timer.reset"),
                "Reset to focus. Undo available for ten seconds.",
              )
            }
          >
            Reset timer
          </button>
          {snapshot.undoTimerUntil && snapshot.undoTimerUntil > Date.now() && (
            <button onClick={() => void run(() => send("timer.undo"))}>
              Undo timer reset
            </button>
          )}
        </div>
        <h3>Water</h3>
        <p>
          {(waterTotal(s) / 1000).toFixed(2)} L consumed. Selected bottle click:{" "}
          {s.settings.quickMl} mL.
        </p>
        <div className="row">
          {[350, 1000].map((ml) => (
            <button
              key={ml}
              onClick={() =>
                void run(
                  () => send("water.add", { ml }),
                  `Logged ${ml} mL. Undo available for 30 seconds.`,
                )
              }
            >
              Log {ml} mL
            </button>
          ))}
          <button onClick={() => void run(() => send("water.snooze"))}>
            Snooze reminder 15 minutes
          </button>
          {snapshot.undoWater && snapshot.undoWater.until > Date.now() && (
            <button
              onClick={() =>
                void run(
                  () =>
                    send("water.delete", { itemId: snapshot.undoWater!.id }),
                  "Drink undone.",
                )
              }
            >
              Undo last drink
            </button>
          )}
        </div>
        <label>
          Bottle click amount
          <select
            value={s.settings.quickMl}
            onChange={(e) =>
              void run(
                () =>
                  send("settings", {
                    patch: { quickMl: Number(e.target.value) },
                  }),
                "Bottle click amount saved. No drink logged.",
              )
            }
          >
            <option value={350}>350 mL</option>
            <option value={1000}>1,000 mL</option>
          </select>
        </label>
        <h3>Position</h3>
        <div className="row">
          {["left", "up", "down", "right", "center"].map((x) => (
            <button
              key={x}
              onClick={() => void run(() => action("position-" + x))}
            >
              {x === "center" ? "Recover position" : `Move ${x}`}
            </button>
          ))}
        </div>
        <h3>Motion and appearance</h3>
        <div className="row">
          {[
            ["stop-motion", "Stop motion"],
            ["reset-pose", "Reset pose"],
            ["gust", "Gentle gust"],
            ["layout", "Beta layout editor"],
            ["charms", "Manage charms"],
            ["tasks", "Tasks"],
            ["notes", "Notes"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => void run(() => action(id))}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <p>
        Click the bottle to log its selected amount. Drag more than six pixels
        to move a charm without activating it. Drag the hoop to move the widget.
      </p>
    </section>
  );
}
