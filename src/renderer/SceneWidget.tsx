import { useEffect, useRef, useState } from "react";
import { CharmScene, type SceneOptions } from "./Scene";
import {
  defaultAppearance,
  validateLayoutEnvelope,
  type Appearance,
  type Instance,
} from "../shared/appearance";
import {
  FOCUS,
  REST,
  localDate,
  waterTotal,
  type Snapshot,
} from "../shared/model";
import { widgetSizes, hoopOpening } from "../shared/layout";
import { action } from "./api";
export type Send = (
  type: string,
  data?: Record<string, unknown>,
  id?: string,
) => Promise<Snapshot>;
const format = (ms: number) =>
  `${Math.floor(Math.ceil(ms / 1000) / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(Math.ceil(ms / 1000) % 60).toString().padStart(2, "0")}`;
export function SceneWidget({
  snapshot,
  send,
  appearance,
  editing = false,
  onSelect,
}: {
  snapshot: Snapshot;
  send: Send;
  appearance?: Appearance;
  editing?: boolean;
  onSelect?: (id: Instance) => void;
}) {
  const s = snapshot.state;
  let a = appearance ?? s.settings.appearance ?? defaultAppearance();
  let layoutIssue = "";
  try {
    validateLayoutEnvelope(a, s.settings);
  } catch (error) {
    layoutIssue = editing
      ? `Draft needs adjustment: ${(error as Error).message}`
      : `Saved layout needs adjustment: ${(error as Error).message} A recovery layout is shown; your saved sizes are preserved.`;
    if (!editing) a = defaultAppearance();
  }
  const [width, height] = widgetSizes[s.settings.scale];
  const host = useRef<HTMLDivElement>(null),
    timer = useRef<HTMLDivElement>(null),
    undoButton = useRef<HTMLButtonElement>(null),
    scene = useRef<CharmScene | undefined>(undefined);
  const [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState(""),
    [undoBusy, setUndoBusy] = useState(false),
    [heldUndo, setHeldUndo] = useState<{ id: string; until: number } | null>(
      null,
    ),
    [clock, setClock] = useState(Date.now()),
    [osReduced, setOsReduced] = useState(
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const undoInFlight = useRef(false);
  const pending = useRef(false),
    retryDrink = useRef<{ id: string; ml: number } | null>(null),
    lastClick = useRef(-Infinity);
  const reduced = s.settings.reducedMotion || osReduced;
  const total = waterTotal(s),
    goal = s.dailyGoals[localDate(new Date())] ?? s.settings.goalMl;
  const available =
    snapshot.undoWater && snapshot.undoWater.until > clock
      ? snapshot.undoWater
      : null;
  const undo =
    heldUndo && s.drinks.some((d) => d.id === heldUndo.id)
      ? heldUndo
      : available;
  const gesture = useRef<
    | {
        id: Instance;
        pointer: number;
        x: number;
        y: number;
        lastX: number;
        lastY: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const pointer = useRef<{ x: number; y: number; t: number } | undefined>(
    undefined,
  );
  const cancel = () => {
    gesture.current = undefined;
    pointer.current = undefined;
    scene.current?.releaseGrab();
  };
  const opts: SceneOptions = {
    appearance: a,
    settings: s.settings,
    fill: Math.min(total / goal, 1),
    glow: s.settings.reminders && s.reminderRemainingMs === 0 && total < goal,
    reduced: reduced || snapshot.blockers.length > 0,
    editing,
    onStatus: setError,
    onPosition: (id, x, y) => {
      const n =
        id === "hoop"
          ? timer.current
          : id === "bottle"
            ? undoButton.current
            : null;
      if (n) {
        n.style.left = `${id === "bottle" ? Math.max(12, Math.min(width - 12, x)) : x}px`;
        n.style.top = `${id === "bottle" ? Math.max(12, Math.min(height - 12, y + 15)) : y}px`;
      }
    },
  };
  const current = useRef(opts);
  current.current = opts;
  useEffect(() => {
    setError("");
    try {
      scene.current = new CharmScene(host.current!, current.current);
    } catch (e) {
      setError(String(e));
    }
    return () => {
      cancel();
      scene.current?.dispose();
    };
  }, [
    attempt,
    JSON.stringify(a.scales),
    JSON.stringify(a.links),
    JSON.stringify(s.settings.charms),
    s.settings.decoration,
    s.settings.name,
    s.settings.nameStyle,
    s.settings.neonColor,
    JSON.stringify(s.settings.extras),
  ]);
  useEffect(() => {
    cancel();
    scene.current?.update(current.current);
  }, [width, height, editing, reduced, snapshot.blockers.join(",")]);
  useEffect(() => scene.current?.update(current.current), [snapshot, a]);
  useEffect(() => {
    if (!snapshot.undoWater) return;
    setClock(Date.now());
    const timeout = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, snapshot.undoWater.until - Date.now()) + 20,
    );
    scene.current?.wake();
    return () => clearTimeout(timeout);
  }, [snapshot.undoWater?.id, snapshot.undoWater?.until]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("view") !== "scene-proof")
      return;
    const gust = () => scene.current?.gust(600, -100);
    window.addEventListener("fixture-gust", gust);
    return () => window.removeEventListener("fixture-gust", gust);
  }, []);
  useEffect(
    () =>
      window.charme?.onMotion((name) => {
        if (name === "gust") scene.current?.gust(250, 0);
        else if (name === "reset-pose") scene.current?.resetPose();
        else scene.current?.stop();
      }),
    [],
  );
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setOsReduced(q.matches);
    q.addEventListener("change", change);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      q.removeEventListener("change", change);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, []);
  const run = async (type: string, data?: Record<string, unknown>) => {
    try {
      await send(type, data);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const log = async () => {
    if (
      editing ||
      pending.current ||
      performance.now() - lastClick.current < 350
    )
      return;
    pending.current = true;
    lastClick.current = performance.now();
    const command = retryDrink.current ?? {
      id: crypto.randomUUID(),
      ml: s.settings.quickMl,
    };
    retryDrink.current = command;
    try {
      await send("water.add", { ml: command.ml }, command.id);
      retryDrink.current = null;
      setNotice(
        `Logged ${command.ml} milliliters. Undo available for 30 seconds.`,
      );
    } catch (e) {
      setNotice(
        `Drink could not be confirmed. Click the bottle to retry safely. ${(e as Error).message}`,
      );
    } finally {
      pending.current = false;
    }
  };
  const diameter = ((hoopOpening * width) / 0.92) * a.scales.hoop;
  return (
    <div
      className={`widget scene-widget ${reduced ? "reduced" : ""}`}
      style={{ width, height, transform: "none" }}
      onPointerLeave={() => {
        pointer.current = undefined;
        if (!gesture.current) window.charme?.hit(false);
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (g) {
          if (e.pointerId !== g.pointer) return;
          const dx = e.clientX - g.lastX,
            dy = e.clientY - g.lastY;
          g.moved ||= Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6;
          if (g.moved) {
            if (g.id === "hoop") window.charme?.move(dx, dy);
            else scene.current?.drag(dx, dy);
          }
          g.lastX = e.clientX;
          g.lastY = e.clientY;
          return;
        }
        if ((e.target as Element).closest("[data-hit]")) {
          pointer.current = undefined;
          window.charme?.hit(true);
          return;
        }
        const id = scene.current?.pick(e.clientX, e.clientY);
        window.charme?.hit(!!id);
        const now = performance.now(),
          old = pointer.current;
        pointer.current = { x: e.clientX, y: e.clientY, t: now };
        if (id && old && !editing && now - old.t > 0 && now - old.t < 100)
          scene.current?.gust(
            ((e.clientX - old.x) * 1000) / (now - old.t),
            ((e.clientY - old.y) * 1000) / (now - old.t),
          );
      }}
      onPointerDown={(e) => {
        if (
          e.button !== 0 ||
          !e.isPrimary ||
          gesture.current ||
          (e.target as Element).closest("[data-hit]")
        )
          return;
        const id = scene.current?.pick(e.clientX, e.clientY);
        if (!id) return;
        if (editing) {
          onSelect?.(id);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = {
          id,
          pointer: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
        };
        scene.current?.grab(id);
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || e.pointerId !== g.pointer) return;
        const releasedOn = scene.current?.pick(e.clientX, e.clientY);
        cancel();
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (!g.moved && releasedOn === g.id) {
          if (g.id === "bottle") void log();
          if (g.id === "notebook")
            void action("hub").catch((e) => setNotice(e.message));
        }
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <div className="scene-canvas" ref={host} aria-hidden="true" />
      <div
        ref={timer}
        className="scene-timer"
        data-hit
        style={{
          width: diameter,
          height: diameter,
          transform: "translate(-50%,-50%)",
        }}
      >
        <span>{s.timer.phase === "focus" ? "Focus" : "Rest"}</span>
        <button
          disabled={editing}
          className="digits"
          style={{
            fontSize:
              s.settings.scale === "small"
                ? 18
                : s.settings.scale === "medium"
                  ? 24
                  : 28,
          }}
          aria-label={`${s.timer.phase}, ${format(s.timer.remainingMs)} remaining; ${snapshot.blockers.length ? "system paused" : s.timer.intent ? "running" : "manually paused"}. ${s.timer.intent ? "Pause" : "Resume"} timer`}
          onClick={() =>
            void run(s.timer.intent ? "timer.pause" : "timer.resume")
          }
        >
          {format(s.timer.remainingMs)}
        </button>
        <progress
          aria-label="Timer phase progress"
          max={s.timer.phase === "focus" ? FOCUS : REST}
          value={
            (s.timer.phase === "focus" ? FOCUS : REST) - s.timer.remainingMs
          }
        />
        {s.settings.scale !== "small" && (
          <button
            disabled={editing}
            aria-label="Reset timer to 45 minutes"
            onClick={() => void run("timer.reset")}
          >
            ↺
          </button>
        )}
      </div>
      <span
        className="sr-only"
        role="progressbar"
        aria-label={`Water: ${total} of ${goal} milliliters. Bottle click logs ${s.settings.quickMl} milliliters. Full keyboard controls are available in the tray.`}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(total, goal)}
      />
      {undo && (
        <button
          ref={undoButton}
          className="scene-undo"
          data-hit
          aria-label="Undo last drink"
          title="Undo last drink"
          disabled={editing || undoBusy}
          onFocus={() => {
            setHeldUndo(undo);
            scene.current?.grab("bottle");
          }}
          onBlur={() => {
            setHeldUndo(null);
            scene.current?.releaseGrab();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setHeldUndo(undo);
            scene.current?.grab("bottle");
          }}
          onClick={async () => {
            if (undoInFlight.current) return;
            undoInFlight.current = true;
            setUndoBusy(true);
            const target = undo.id;
            try {
              await send("water.delete", { itemId: target });
              setNotice("Drink removed.");
              setHeldUndo(null);
              timer.current
                ?.querySelector<HTMLButtonElement>(".digits")
                ?.focus({ preventScroll: true });
            } catch (error) {
              setNotice(`Undo failed. ${(error as Error).message}`);
            } finally {
              undoInFlight.current = false;
              setUndoBusy(false);
              scene.current?.releaseGrab();
            }
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              transform="translate(0 -2)"
            />
          </svg>
        </button>
      )}
      <div className="sr-only" role="status">
        {notice}
      </div>
      {layoutIssue && (
        <button
          className="layout-recovery"
          data-hit
          title={layoutIssue}
          aria-label={layoutIssue + " Open layout editor"}
          onClick={() =>
            void action("layout").catch((e) => setNotice(e.message))
          }
        >
          Fix layout
        </button>
      )}
      {error.startsWith("Optional charm") && (
        <button
          className="layout-recovery"
          data-hit
          title={error}
          aria-label={error}
          onClick={() =>
            void action("charms").catch((e) => setNotice(e.message))
          }
        >
          Fix charm
        </button>
      )}
      {((error && !error.startsWith("Optional charm")) ||
        notice.includes("could not")) && (
        <div className="scene-error" data-hit role="alert">
          <p>{error || notice}</p>
          <button
            onClick={() =>
              void action("controls").catch((e) => setNotice(e.message))
            }
          >
            Controls
          </button>
          {error && (
            <button
              onClick={() => {
                setError("");
                setAttempt((x) => x + 1);
              }}
            >
              Retry graphics
            </button>
          )}
        </div>
      )}
    </div>
  );
}
