import { inspectGlb } from "./assets";
import { validateLibrary } from "../shared/library";
import { widgetSizes } from "../shared/layout";
import { validateAppearance } from "../shared/appearance";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  screen,
  shell,
  powerMonitor,
  dialog,
  Notification,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { Snapshot } from "../shared/model";
import { Storage } from "./storage";
import { Service } from "./service";
import { startServer } from "./server";
const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.join(here, "../dist");
if (process.env.CHARME_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.CHARME_DATA_DIR));
if (!app.requestSingleInstanceLock()) app.quit();
let widget: BrowserWindow,
  panel: BrowserWindow | undefined,
  tray: Tray,
  service: Service,
  quitting = false,
  dashboard: Awaited<ReturnType<typeof startServer>>;
const preferences = {
  preload: path.join(here, "preload.cjs"),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};
function clamp(win: BrowserWindow) {
  const b = win.getBounds(),
    a = screen.getDisplayMatching(b).workArea;
  win.setPosition(
    Math.max(a.x, Math.min(b.x, a.x + a.width - b.width)),
    Math.max(a.y, Math.min(b.y, a.y + a.height - b.height)),
  );
}
function secure(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
}
const flushRequests = new Map<string, (error: string | null) => void>();
async function flushPanel() {
  if (!panel || panel.isDestroyed()) return;
  await new Promise<void>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      flushRequests.delete(id);
      reject(
        Error(
          "The editor did not confirm saving. Please keep it open and try again.",
        ),
      );
    }, 120000);
    flushRequests.set(id, (error) => {
      clearTimeout(timeout);
      flushRequests.delete(id);
      error ? reject(Error(error)) : resolve();
    });
    panel!.webContents.send("flush-edits", id);
  });
}
function openPanel(view = "tasks") {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send("navigate", view);
    panel.show();
    panel.focus();
    return;
  }
  const b = widget.getBounds();
  panel = new BrowserWindow({
    width: 820,
    minWidth: 420,
    height: 680,
    x: b.x - 570,
    y: b.y,
    show: false,
    backgroundColor: "#202321",
    title: "Charme",
    webPreferences: preferences,
  });
  secure(panel);
  void panel.loadURL(`${dashboard.origin}/?view=${encodeURIComponent(view)}`);
  panel.once("ready-to-show", () => {
    clamp(panel!);
    panel!.show();
  });
  let closeApproved = false;
  panel.on("close", (event) => {
    if (closeApproved || quitting) return;
    event.preventDefault();
    void flushPanel()
      .then(() => {
        closeApproved = true;
        panel?.close();
      })
      .catch((error) => dialog.showErrorBox("Edits not saved", String(error)));
  });
  panel.webContents.on("render-process-gone", () => {
    widget.webContents.send("appearance-preview", null);
    widget.webContents.send("library-preview", null);
  });
  panel.on("closed", () => {
    widget.webContents.send("appearance-preview", null);
    widget.webContents.send("library-preview", null);
    panel = undefined;
  });
}
function menu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show / Hide Charme",
        click: () =>
          widget.isVisible() ? widget.hide() : widget.showInactive(),
      },
      {
        label: service.state.timer.intent ? "Pause timer" : "Resume timer",
        click: () =>
          void service.command({
            id: crypto.randomUUID(),
            type: service.state.timer.intent ? "timer.pause" : "timer.resume",
          }),
      },
      {
        label: "Controls",
        click: () => openPanel("controls"),
      },
      {
        label: "Notebook",
        click: () => openPanel(service.state.settings.lastTab),
      },
      {
        label: "Dashboard",
        click: () => void shell.openExternal(dashboard.launchUrl()),
      },
      { label: "Manage charms", click: () => openPanel("charms") },
      { label: "Settings", click: () => openPanel("settings") },
      {
        label: "Reset position",
        click: () => {
          const a = screen.getPrimaryDisplay().workArea;
          widget.setPosition(a.x + a.width - 450, a.y + 40);
          widget.showInactive();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (
    ![widget?.webContents.id, panel?.webContents.id].includes(
      event.sender.id,
    ) ||
    event.senderFrame !== event.sender.mainFrame ||
    new URL(event.senderFrame.url).origin !== dashboard.origin
  )
    throw Error("Untrusted sender");
}
app.on("second-instance", () => widget?.showInactive());
app.on("activate", () => widget?.showInactive());
app.whenReady().then(async () => {
  try {
    service = new Service(new Storage(app.getPath("userData")));
    await service.initialize();
    dashboard = await startServer(service, root, (name) => {
      if (!widget || widget.isDestroyed()) throw Error("Widget is not ready");
      if (name === "stop-motion" || name === "reset-pose" || name === "gust") {
        widget.webContents.send("motion", name);
        return;
      }
      const [x, y] = widget.getPosition();
      const directions: Record<string, [number, number]> = {
        "position-left": [-20, 0],
        "position-right": [20, 0],
        "position-up": [0, -20],
        "position-down": [0, 20],
      };
      if (name === "position-center") {
        const a = screen.getPrimaryDisplay().workArea;
        widget.setPosition(
          a.x + Math.round((a.width - widget.getSize()[0]) / 2),
          a.y + 30,
        );
      } else if (directions[name])
        widget.setPosition(x + directions[name][0], y + directions[name][1]);
      clamp(widget);
    });
    const a = screen.getPrimaryDisplay().workArea;
    widget = new BrowserWindow({
      width: 270,
      height: 401,
      x: a.x + a.width - 460,
      y: a.y + 30,
      frame: false,
      transparent: true,
      resizable: false,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      skipTaskbar: true,
      webPreferences: preferences,
    });
    secure(widget);
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2NkYGD4z0ABYBw1gGE0DBgGAACd7gEfhhkR6AAAAABJRU5ErkJggg==",
    );
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setTitle("◌");
    tray.setToolTip("Charme");
    tray.on("click", () =>
      widget.isVisible() ? widget.hide() : widget.showInactive(),
    );
    menu();
    ipcMain.on("flush-result", (e, id, error) => {
      trusted(e);
      if (e.sender.id === panel?.webContents.id) flushRequests.get(id)?.(error);
    });
    ipcMain.on("library-preview", (e, value) => {
      trusted(e);
      if (e.sender.id !== panel?.webContents.id) return;
      if (value !== null) {
        try {
          validateLibrary(value);
          if (
            value.assets.some(
              (a: any) =>
                !service.state.settings.charms?.assets.some(
                  (saved) => saved.id === a.id,
                ),
            )
          )
            return;
        } catch {
          return;
        }
      }
      widget.webContents.send("library-preview", value);
    });
    ipcMain.on("appearance-preview", (e, value) => {
      trusted(e);
      if (e.sender.id !== panel?.webContents.id) return;
      if (value !== null) {
        try {
          validateAppearance(value);
        } catch {
          return;
        }
      }
      widget.webContents.send("appearance-preview", value);
    });
    ipcMain.handle("snapshot", (e) => {
      trusted(e);
      return service.snapshot();
    });
    ipcMain.handle("command", (e, c) => {
      trusted(e);
      return service.command(c);
    });
    ipcMain.handle("asset", async (e, id) => {
      trusted(e);
      if (!service.state.settings.charms?.assets.some((a) => a.id === id))
        throw Error("Unknown asset");
      return new Uint8Array(await service.assets.read(id));
    });
    ipcMain.handle("asset-validate", (e, bytes, name) => {
      trusted(e);
      if (e.sender.id !== panel?.webContents.id)
        throw Error("Open the charm editor to validate models");
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.length > 20_000_000 ||
        typeof name !== "string"
      )
        throw Error("Invalid asset");
      return inspectGlb(Buffer.from(bytes), name);
    });
    ipcMain.handle("asset-import", async (e, bytes, name) => {
      trusted(e);
      if (e.sender.id !== panel?.webContents.id)
        throw Error("Open Manage charms to import");
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength > 20_000_000 ||
        typeof name !== "string"
      )
        throw Error("Invalid import");
      return service.importAsset(Buffer.from(bytes), name);
    });
    ipcMain.on("hit", (e, active) => {
      trusted(e);
      if (e.sender.id === widget.webContents.id)
        widget.setIgnoreMouseEvents(!Boolean(active), { forward: true });
    });
    ipcMain.on("move", (e, dx, dy) => {
      trusted(e);
      if (
        e.sender.id !== widget.webContents.id ||
        !Number.isFinite(dx) ||
        !Number.isFinite(dy)
      )
        return;
      const [x, y] = widget.getPosition();
      widget.setPosition(
        x + Math.round(Math.max(-100, Math.min(100, dx))),
        y + Math.round(Math.max(-100, Math.min(100, dy))),
      );
    });
    ipcMain.handle("action", async (e, name) => {
      trusted(e);
      if (typeof name === "string" && name.startsWith("position-")) {
        const [x, y] = widget.getPosition();
        const direction = name.slice(9);
        const delta: Record<string, [number, number]> = {
          left: [-20, 0],
          right: [20, 0],
          up: [0, -20],
          down: [0, 20],
        };
        if (direction === "center") {
          const a = screen.getPrimaryDisplay().workArea;
          widget.setPosition(
            a.x + Math.round((a.width - widget.getSize()[0]) / 2),
            a.y + 30,
          );
        } else if (delta[direction])
          widget.setPosition(x + delta[direction][0], y + delta[direction][1]);
        clamp(widget);
        return;
      }
      switch (name) {
        case "reset-pose":
        case "stop-motion":
        case "gust":
          widget.webContents.send("motion", name);
          break;
        case "reset-all": {
          const confirm = await dialog.showMessageBox({
            type: "warning",
            buttons: ["Cancel", "Delete all Charme data"],
            defaultId: 0,
            cancelId: 0,
            message: "Delete all tasks, notes, history and managed backups?",
            detail:
              "This cannot be undone. Export a backup first if you want to keep your data.",
          });
          if (confirm.response === 1) await service.resetAll();
          break;
        }

        case "hub":
          openPanel(
            service.state.settings.hubTab ?? service.state.settings.lastTab,
          );
          break;
        case "controls":
        case "charms":
        case "layout":
        case "tasks":
        case "notes":
        case "settings":
          openPanel(name);
          break;
        case "dashboard":
          await shell.openExternal(dashboard.launchUrl());
          break;
        case "close":
          if (e.sender.id === panel?.webContents.id) panel.close();
          break;
        case "data":
          await shell.openPath(app.getPath("userData"));
          break;
        case "export": {
          const r = await dialog.showSaveDialog({
            defaultPath: "charme-backup.charme",
            filters: [
              { name: "Charme backup", extensions: ["charme", "json"] },
            ],
          });
          if (r.filePath)
            await writeFile(r.filePath, await service.exportBackup(), {
              mode: 0o600,
            });
          break;
        }
        case "restore": {
          const r = await dialog.showOpenDialog({
            filters: [
              { name: "Charme backup", extensions: ["charme", "json"] },
            ],
            properties: ["openFile"],
          });
          if (!r.canceled) {
            const confirm = await dialog.showMessageBox({
              type: "warning",
              buttons: ["Cancel", "Restore"],
              defaultId: 0,
              message: "Replace Charme data with this backup?",
              detail:
                "A pre-restore backup will be kept. The timer will be paused.",
            });
            if (confirm.response === 1)
              await service.restoreBackup(await readFile(r.filePaths[0]));
          }
          break;
        }
        default:
          throw Error("Unknown action");
      }
    });
    let previous = service.snapshot();
    service.on("state", (snapshot: Snapshot) => {
      for (const w of [widget, panel])
        if (w && !w.isDestroyed()) w.webContents.send("state", snapshot);
      widget.setAlwaysOnTop(snapshot.state.settings.alwaysOnTop);
      const desired = [...widgetSizes[snapshot.state.settings.scale]] as [
        number,
        number,
      ];
      const size = widget.getSize();
      if (size[0] !== desired[0]) {
        widget.setSize(...desired);
        clamp(widget);
      }
      if (
        snapshot.state.settings.launchAtLogin !==
        previous.state.settings.launchAtLogin
      )
        app.setLoginItemSettings({
          openAtLogin: snapshot.state.settings.launchAtLogin,
        });
      if (
        snapshot.state.timer.id !== previous.state.timer.id &&
        snapshot.state.settings.sound
      )
        shell.beep();
      if (
        snapshot.state.timer.id !== previous.state.timer.id &&
        snapshot.state.settings.notifications &&
        Notification.isSupported()
      )
        new Notification({
          title: "Charme",
          body:
            snapshot.state.timer.phase === "rest"
              ? "Time for a 15-minute rest."
              : "Your next focus session has started.",
        }).show();
      if (snapshot.state.timer.intent !== previous.state.timer.intent) menu();
      previous = snapshot;
    });
    for (const [on, off, reason] of [
      ["suspend", "resume", "sleep"],
      ["lock-screen", "unlock-screen", "lock"],
      ["user-did-resign-active", "user-did-become-active", "inactive"],
    ] as const) {
      (powerMonitor as NodeJS.EventEmitter).on(
        on,
        () => void service.block(reason, true),
      );
      (powerMonitor as NodeJS.EventEmitter).on(
        off,
        () => void service.block(reason, false),
      );
    }
    if (powerMonitor.getSystemIdleState(1) === "locked")
      await service.block("lock", true);
    screen.on("display-removed", () => {
      clamp(widget);
      if (panel) clamp(panel);
    });
    widget.on("moved", () => {
      void service.storage
        .atomic("window.json", widget.getBounds())
        .catch(() => {});
    });
    try {
      const b = JSON.parse(
        await readFile(service.storage.file("window.json"), "utf8"),
      );
      if (Number.isFinite(b.x) && Number.isFinite(b.y))
        widget.setPosition(b.x, b.y);
    } catch {}
    clamp(widget);
    await widget.loadURL(`${dashboard.origin}/?view=widget`);
    widget.showInactive();
    setInterval(() => void service.tick(), 1000).unref();
    console.log(`CHARME_READY ${dashboard.launchUrl()}`);
  } catch (e) {
    console.error(e);
    dialog.showErrorBox("Charme could not start", String(e));
    app.exit(1);
  }
});
app.on("window-all-closed", () => {});
app.on("before-quit", (e) => {
  if (quitting || !service) return;
  e.preventDefault();
  quitting = true;
  void flushPanel()
    .then(() => service.close())
    .then(() => {
      dashboard?.server.close();
      app.quit();
    })
    .catch((error) => {
      quitting = false;
      dialog.showErrorBox("Could not save Charme", String(error));
    });
});
