import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("charme", {
  onFlush: (fn: () => Promise<void>) => {
    const listener = async (_: unknown, id: string) => {
      try {
        await fn();
        ipcRenderer.send("flush-result", id, null);
      } catch (error) {
        ipcRenderer.send("flush-result", id, String(error));
      }
    };
    ipcRenderer.on("flush-edits", listener);
    return () => ipcRenderer.removeListener("flush-edits", listener);
  },
  previewLibrary: (value: unknown) =>
    ipcRenderer.send("library-preview", value),
  onLibraryPreview: (fn: (value: unknown) => void) => {
    const listener = (_: unknown, value: unknown) => fn(value);
    ipcRenderer.on("library-preview", listener);
    return () => ipcRenderer.removeListener("library-preview", listener);
  },
  preview: (value: unknown) => ipcRenderer.send("appearance-preview", value),
  onPreview: (fn: (value: unknown) => void) => {
    const listener = (_: unknown, value: unknown) => fn(value);
    ipcRenderer.on("appearance-preview", listener);
    return () => ipcRenderer.removeListener("appearance-preview", listener);
  },
  onMotion: (fn: (name: string) => void) => {
    const listener = (_: unknown, name: string) => fn(name);
    ipcRenderer.on("motion", listener);
    return () => ipcRenderer.removeListener("motion", listener);
  },
  asset: (id: string) => ipcRenderer.invoke("asset", id),
  validateAsset: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke("asset-validate", bytes, name),
  importAsset: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke("asset-import", bytes, name),
  snapshot: () => ipcRenderer.invoke("snapshot"),
  command: (c: unknown) => ipcRenderer.invoke("command", c),
  onState: (fn: (s: unknown) => void) => {
    const handler = (_: unknown, s: unknown) => fn(s);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
  onNavigate: (fn: (view: string) => void) => {
    const handler = (_: unknown, view: string) => fn(view);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
  action: (name: string) => ipcRenderer.invoke("action", name),
  hit: (active: boolean) => ipcRenderer.send("hit", active),
  move: (dx: number, dy: number) => ipcRenderer.send("move", dx, dy),
});
