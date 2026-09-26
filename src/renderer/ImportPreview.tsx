import { useEffect, useRef } from "react";
/** Decoding, GPU setup, and picking run in a disposable worker, never the editor thread. */
export function ImportPreview() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let worker: Worker | undefined,
      timeout: ReturnType<typeof setTimeout> | undefined,
      generation = 0;
    const dispose = () => {
      clearTimeout(timeout);
      worker?.terminate();
      worker = undefined;
      host.current?.replaceChildren();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== location.origin) return;
      if (event.data?.type === "camera") {
        worker?.postMessage(event.data);
        return;
      }
      if (event.data?.type !== "preview") return;
      dispose();
      const mine = ++generation,
        value = event.data;
      const canvas = document.createElement("canvas");
      canvas.style.width = "320px";
      canvas.style.height = "300px";
      host.current!.append(canvas);
      if (!canvas.transferControlToOffscreen) {
        parent.postMessage(
          {
            type: "preview-error",
            request: value.request,
            error:
              "This browser cannot isolate GLB previews. Use the native Charme app.",
          },
          "*",
        );
        return;
      }
      try {
        worker = new Worker(new URL("./preview.worker.ts", import.meta.url), {
          type: "module",
        });
        timeout = setTimeout(() => {
          if (mine !== generation) return;
          dispose();
          parent.postMessage(
            {
              type: "preview-error",
              request: value.request,
              error:
                "Preview exceeded 30 seconds and its worker was terminated.",
            },
            "*",
          );
        }, 30000);
        worker.onmessage = (e) => {
          if (mine !== generation) return;
          if (e.data.type === "preview-ready") {
            clearTimeout(timeout);
            const marker = document.createElement("span");
            marker.className = "attachment-marker";
            marker.textContent = "+";
            marker.setAttribute("aria-hidden", "true");
            marker.style.left = `${e.data.marker[0]}px`;
            marker.style.top = `${e.data.marker[1]}px`;
            if (value.editing) host.current!.append(marker);
          }
          if (e.data.type === "preview-error") {
            clearTimeout(timeout);
            worker?.terminate();
          }
          parent.postMessage(e.data, "*");
        };
        worker.onerror = (e) => {
          clearTimeout(timeout);
          worker?.terminate();
          parent.postMessage(
            {
              type: "preview-error",
              request: value.request,
              error: e.message || "Preview worker failed.",
            },
            "*",
          );
        };
        let down: { x: number; y: number } | null = null,
          moved = false;
        canvas.style.touchAction = "none";
        canvas.onpointerdown = (e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          down = { x: e.clientX, y: e.clientY };
          moved = false;
          canvas.setPointerCapture(e.pointerId);
        };
        canvas.onpointermove = (e) => {
          if (!down) return;
          const dx = e.clientX - down.x,
            dy = e.clientY - down.y;
          if (moved || Math.hypot(dx, dy) > 6) {
            moved = true;
            worker?.postMessage({ type: "camera", dx, dy });
            down = { x: e.clientX, y: e.clientY };
          }
        };
        canvas.onpointercancel = canvas.onlostpointercapture = () => {
          down = null;
          moved = true;
        };
        canvas.onpointerup = (e) => {
          if (!down) return;
          down = null;
          if (moved || !value.editing) return;
          const rect = canvas.getBoundingClientRect();
          worker?.postMessage({
            type: "pick",
            request: value.request,
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: 1 - ((e.clientY - rect.top) / rect.height) * 2,
          });
        };
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage(
          { ...value, canvas: offscreen, pixelRatio: devicePixelRatio },
          [offscreen, value.bytes],
        );
      } catch (error) {
        dispose();
        parent.postMessage(
          {
            type: "preview-error",
            request: value.request,
            error: `Preview could not start: ${String(error)}`,
          },
          "*",
        );
      }
    };
    window.addEventListener("message", receive);
    parent.postMessage({ type: "preview-mounted" }, "*");
    return () => {
      generation++;
      dispose();
      window.removeEventListener("message", receive);
    };
  }, []);
  return (
    <div
      ref={host}
      style={{
        width: 320,
        height: 300,
        position: "relative",
        background: "#292e2b",
      }}
    />
  );
}
