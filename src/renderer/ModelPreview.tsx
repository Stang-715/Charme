import { useEffect, useRef, useState } from "react";
import { charmById } from "../shared/charms";
import { assetBytes } from "./api";
import type { Slot } from "../shared/library";
export function ModelPreview({
  asset,
  file,
  slot,
  editing = false,
  onReady,
  onAttachment,
}: {
  asset: string;
  file?: File;
  slot: Slot;
  editing?: boolean;
  onReady: (valid: boolean, recommended?: [number, number, number]) => void;
  onAttachment?: (point: [number, number, number]) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef({ onReady, onAttachment });
  callbacks.current = { onReady, onAttachment };
  const [retry, setRetry] = useState(0),
    [status, setStatus] = useState("Loading preview…"),
    [failed, setFailed] = useState(false);
  const signature = JSON.stringify(slot);
  useEffect(() => {
    let canceled = false,
      mounted = false,
      bytes: ArrayBuffer | undefined;
    if (![...slot.rotation, ...slot.attachment].every(Number.isFinite)) {
      setStatus(
        "Enter valid orientation and attachment values to resume preview.",
      );
      callbacks.current.onReady(false);
      return;
    }
    const request = crypto.randomUUID();
    setStatus("Loading preview…");
    setFailed(false);
    callbacks.current.onReady(false);
    const post = () => {
      if (mounted && bytes && !canceled)
        frame.current?.contentWindow?.postMessage(
          {
            type: "preview",
            request,
            bytes,
            rotation: slot.rotation,
            attachment: slot.attachment,
            baseRotation:
              asset === "duck"
                ? [0, -Math.PI / 2, 0]
                : charmById(asset)?.rotation,
            editing,
            nameTag:
              asset === "tag"
                ? {
                    name: slot.name || "Your name",
                    style: slot.nameStyle || "metal",
                    color: slot.nameColor || "#9cf6d3",
                  }
                : null,
          },
          location.origin,
        );
    };
    const timeout = setTimeout(() => {
      canceled = true;
      frame.current?.removeAttribute("src");
      setFailed(true);
      setStatus("Preview timed out. Retry to start a fresh renderer.");
      callbacks.current.onReady(false);
    }, 30000);
    const receive = (e: MessageEvent) => {
      if (
        canceled ||
        e.source !== frame.current?.contentWindow ||
        e.origin !== location.origin
      )
        return;
      if (e.data?.type === "preview-mounted") {
        mounted = true;
        post();
        return;
      }
      if (e.data?.request !== request) return;
      if (e.data.type === "preview-ready") {
        clearTimeout(timeout);
        setStatus(
          editing
            ? "Adjust the tether point or rest orientation below."
            : "Drag to rotate the view. Adding is a separate action.",
        );
        callbacks.current.onReady(e.data.attachmentValid, e.data.recommended);
      }
      if (e.data.type === "preview-error") {
        clearTimeout(timeout);
        setFailed(true);
        setStatus(e.data.error);
        callbacks.current.onReady(false);
      }
      if (e.data.type === "attachment" && editing)
        callbacks.current.onAttachment?.(e.data.point);
    };
    window.addEventListener("message", receive);
    (async () => {
      bytes = file
        ? await file.arrayBuffer()
        : asset.startsWith("upload-")
          ? await assetBytes(asset)
          : await fetch("./" + charmById(asset)!.model).then((r) => {
              if (!r.ok) throw Error("Model file unavailable");
              return r.arrayBuffer();
            });
      post();
    })().catch((e) => {
      if (!canceled) {
        clearTimeout(timeout);
        setFailed(true);
        setStatus(e.message);
      }
    });
    return () => {
      canceled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [asset, file, signature, retry, editing]);
  const camera = (command: string) =>
    frame.current?.contentWindow?.postMessage(
      { type: "camera", command },
      location.origin,
    );
  return (
    <div className="model-viewer">
      <iframe
        key={`${asset}-${signature}-${retry}-${editing}`}
        ref={frame}
        title="Interactive charm preview"
        sandbox="allow-scripts allow-same-origin"
        src="./index.html?view=import-preview"
        className="import-preview"
      />
      <div className="preview-tools" aria-label="Preview camera">
        <button onClick={() => camera("left")}>Rotate left</button>
        <button onClick={() => camera("right")}>Rotate right</button>
        <button onClick={() => camera("in")}>Zoom in</button>
        <button onClick={() => camera("out")}>Zoom out</button>
        <button onClick={() => camera("reset")}>Reset view</button>
      </div>
      <p role={failed ? "alert" : "status"}>{status}</p>
      {failed && (
        <button onClick={() => setRetry((n) => n + 1)}>Retry preview</button>
      )}
    </div>
  );
}
