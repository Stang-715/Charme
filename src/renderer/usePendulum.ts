import { interactiveAt } from "./hitTest";
import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
/** Transform generated assets only. No geometry is constructed by this motion layer. */
export function usePendulum(reduced: boolean) {
  const active = useRef<{
    element: HTMLElement;
    x: number;
    y: number;
    moved: boolean;
    angle: number;
  } | null>(null);
  const frames = useRef(new Map<HTMLElement, number>());
  useEffect(
    () => () => {
      for (const frame of frames.current.values()) cancelAnimationFrame(frame);
    },
    [],
  );
  function settle(element: HTMLElement, angle: number, velocity = 0) {
    const old = frames.current.get(element);
    if (old) cancelAnimationFrame(old);
    if (reduced) {
      element.style.transform = "";
      return;
    }
    let previous = performance.now();
    const update = (time: number) => {
      const dt = Math.min((time - previous) / 1000, 1 / 30);
      previous = time;
      velocity += (-18 * Math.sin(angle) - 4 * velocity) * dt;
      angle += velocity * dt;
      angle = Math.max(-0.45, Math.min(0.45, angle));
      element.style.transform = `rotate(${angle}rad)`;
      if (Math.abs(angle) < 0.001 && Math.abs(velocity) < 0.004) {
        element.style.transform = "";
        frames.current.delete(element);
        return;
      }
      frames.current.set(element, requestAnimationFrame(update));
    };
    frames.current.set(element, requestAnimationFrame(update));
  }
  return (activate?: () => void) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (
        e.button !== 0 ||
        !interactiveAt(e.currentTarget, e.clientX, e.clientY)
      )
        return;
      const element = e.currentTarget;
      cancelAnimationFrame(frames.current.get(element) ?? 0);
      element.setPointerCapture(e.pointerId);
      element.dataset.dragging = "true";
      active.current = {
        element,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        angle: 0,
      };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = active.current;
      if (!d) {
        if (e.buttons === 0 && Math.abs(e.movementX) > 1 && !reduced)
          settle(
            e.currentTarget,
            0,
            Math.max(-1.2, Math.min(1.2, e.movementX * 0.025)),
          );
        return;
      }
      if (d.element !== e.currentTarget) return;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      if (d.moved && !reduced) {
        d.angle = Math.max(-0.4, Math.min(0.4, dx / 170));
        d.element.style.transform = `rotate(${d.angle}rad)`;
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = active.current;
      active.current = null;
      if (!d) return;
      delete d.element.dataset.dragging;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      settle(d.element, d.angle);
      if (!d.moved) activate?.();
    },
    onPointerCancel: () => {
      const d = active.current;
      active.current = null;
      if (d) {
        delete d.element.dataset.dragging;
        settle(d.element, d.angle);
      }
    },
    onLostPointerCapture: () => {
      const d = active.current;
      active.current = null;
      if (d) {
        delete d.element.dataset.dragging;
        settle(d.element, d.angle);
      }
    },
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail === 0) activate?.();
    },
  });
}
