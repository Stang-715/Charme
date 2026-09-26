import type { CharmLibrary, AssetRecord } from "../shared/library";
import type { Appearance } from "../shared/appearance";
import type { Command, Snapshot } from "../shared/model";
declare global {
  interface Window {
    charme?: {
      previewLibrary: (value: CharmLibrary | null) => void;
      onLibraryPreview: (
        fn: (value: CharmLibrary | null) => void,
      ) => () => void;
      onFlush: (fn: () => Promise<void>) => () => void;
      preview: (value: Appearance | null) => void;
      onPreview: (fn: (value: Appearance | null) => void) => () => void;
      onMotion: (fn: (name: string) => void) => () => void;
      asset: (id: string) => Promise<Uint8Array>;
      validateAsset: (bytes: Uint8Array, name: string) => Promise<AssetRecord>;
      importAsset: (bytes: Uint8Array, name: string) => Promise<AssetRecord>;
      snapshot: () => Promise<Snapshot>;
      command: (c: Command) => Promise<Snapshot>;
      onState: (fn: (s: Snapshot) => void) => () => void;
      onNavigate: (fn: (view: string) => void) => () => void;
      action: (name: string) => Promise<void>;
      hit: (active: boolean) => void;
      move: (dx: number, dy: number) => void;
    };
  }
}
let token = sessionStorage.getItem("charme-session");
export async function initialize() {
  if (window.charme) return window.charme.snapshot();
  if (location.hash.length > 1) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: location.hash.slice(1) }),
    });
    history.replaceState(null, "", location.pathname + location.search);
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    token = data.session;
    sessionStorage.setItem("charme-session", token!);
  }
  return request("/api/state");
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "Request failed", response.status);
  return data;
}
export function command(
  type: string,
  data: Record<string, unknown> = {},
  id: string = crypto.randomUUID(),
) {
  const c = { ...data, id, type };
  return window.charme ? window.charme.command(c) : request("/api/command", c);
}
export async function subscribe(
  fn: (s: Snapshot) => void,
  onError: () => void,
  signal: AbortSignal,
) {
  if (window.charme) {
    const dispose = window.charme.onState(fn);
    signal.addEventListener("abort", dispose, { once: true });
    return;
  }
  while (!signal.aborted) {
    try {
      const r = await fetch("/api/events", {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!r.ok || !r.body) throw Error("Disconnected");
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) throw Error("Disconnected");
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (frame.startsWith("data: ")) fn(JSON.parse(frame.slice(6)));
        }
      }
    } catch {
      if (signal.aborted) return;
      onError();
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
export async function action(name: string) {
  if (window.charme) return window.charme.action(name);
  if (
    [
      "hub",
      "tasks",
      "notes",
      "settings",
      "dashboard",
      "controls",
      "layout",
      "charms",
    ].includes(name)
  ) {
    location.assign(`?view=${name === "hub" ? "tasks" : name}`);
    return;
  }
  if (
    name.startsWith("position-") ||
    name === "stop-motion" ||
    name === "reset-pose" ||
    name === "gust"
  )
    return request("/api/desktop-action", { name });
  if (name === "export") {
    const r = await fetch("/api/export", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw Error("Backup export failed");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "charme-backup.charme";
    a.click();
    URL.revokeObjectURL(url);
  }
}
export const restore = (state: unknown) => request("/api/restore", state);

export const resetAll = () =>
  request("/api/reset", { confirmation: "DELETE ALL CHARME DATA" });

export async function assetBytes(id: string): Promise<ArrayBuffer> {
  if (window.charme) {
    const bytes = await window.charme.asset(id);
    return new Uint8Array(bytes).buffer;
  }
  const r = await fetch("/api/assets/" + encodeURIComponent(id), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw Error("Asset unavailable");
  return r.arrayBuffer();
}
export async function importAsset(file: File): Promise<AssetRecord> {
  if (file.size > 20_000_000) throw Error("GLB must be no larger than 20 MB");
  if (window.charme)
    return window.charme.importAsset(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
    );
  const r = await fetch("/api/assets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-Asset-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data;
}
export async function restoreFile(file: File) {
  const r = await fetch("/api/restore-archive", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: file,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data;
}

export async function validateAsset(file: File): Promise<AssetRecord> {
  if (file.size > 20_000_000) throw Error("GLB must be no larger than 20 MB");
  if (window.charme)
    return window.charme.validateAsset(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
    );
  const response = await fetch("/api/assets/validate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-Asset-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value;
}
