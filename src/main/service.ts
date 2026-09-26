import { emptySlot } from "../shared/library";
import { inspectGlb, AssetStore } from "./assets";
import { exportArchive, parseArchive } from "./archive";
import {
  migrateLibrary,
  validateLibrary,
  type CharmLibrary,
} from "../shared/library";
import {
  defaultAppearance,
  validateAppearance,
  validateLayoutEnvelope,
  type Appearance,
} from "../shared/appearance";
import { readdir, unlink } from "node:fs/promises";
import { EventEmitter } from "node:events";
import {
  FOCUS,
  REST,
  initialState,
  newTimer,
  localDate,
  waterTotal,
  validateSettings,
  validateState,
  type State,
  type Snapshot,
  type Blocker,
  type Command,
} from "../shared/model";
import { Storage } from "./storage";
const copy = <T>(v: T): T => structuredClone(v);
const text = (v: unknown, max: number) => {
  if (typeof v !== "string" || v.length > max)
    throw Error("Text is missing or too long");
  return v;
};
export class Service extends EventEmitter {
  state!: State;
  get assets() {
    return new AssetStore(this.storage.file("assets"));
  }
  importAsset(bytes: Buffer, name: string) {
    return this.serial(async () => {
      const record = inspectGlb(bytes, name);
      const exists = await this.assets.read(record.id).then(
        () => true,
        () => false,
      );
      const next = copy(this.state);
      const library = next.settings.charms!;
      if (!library.assets.some((a) => a.id === record.id)) {
        library.assets.push(record);
        library.revision++;
        validateLibrary(library);
        await this.assets.put(bytes, name);
        try {
          await this.commit(next);
        } catch (error) {
          if (!exists)
            await unlink(this.assets.file(record.id)).catch(() => {});
          throw error;
        }
        this.emitState();
      }
      return record;
    });
  }
  exportBackup() {
    return this.serial(() => exportArchive(copy(this.state), this.assets));
  }
  async restoreBackup(bytes: Buffer) {
    return this.serial(async () => {
      const archive = parseArchive(bytes);
      for (const a of archive.assets)
        await this.assets.put(a.bytes, a.record.name);
      for (const a of archive.state.settings.charms?.assets ?? [])
        await this.assets.read(a.id);
      await this.restoreState(archive.state);
    });
  }
  blockers = new Set<Blocker>();
  error: string | null = null;
  recovered = false;
  private queue: Promise<unknown> = Promise.resolve();
  private last = performance.now();
  private checkpointAt = 0;
  private undoTimer: {
    timer: State["timer"];
    sessionId: string;
    until: number;
  } | null = null;
  private undoWater: { id: string; until: number } | null = null;
  private deleted = new Map<
    string,
    {
      kind: "task" | "note";
      value: State["tasks"][number] | State["notes"][number];
    }
  >();
  constructor(
    readonly storage: Storage,
    readonly now = () => new Date(),
    readonly mono = () => performance.now(),
  ) {
    super();
    this.last = mono();
  }
  async initialize() {
    const loaded = await this.storage.load();
    this.state = loaded.state;
    if (this.state.schema === 1) {
      await this.storage.atomic(`pre-upgrade-${Date.now()}.json`, this.state);
      this.state.schema = 2;
    }
    if (!this.state.settings.appearance) {
      await this.storage.atomic(`pre-upgrade-${Date.now()}.json`, this.state);
      this.state.settings.appearance = defaultAppearance();
    }
    if (!this.state.settings.charms) {
      await this.storage.atomic(`pre-upgrade-${Date.now()}.json`, this.state);
      this.state.settings.charms = migrateLibrary(this.state.settings);
    }
    if (
      this.state.schema < 3 ||
      this.state.settings.charms!.version !== 2 ||
      this.state.settings.appearance!.version !== 2
    ) {
      await this.storage.atomic(
        `pre-seven-charms-${Date.now()}.json`,
        this.state,
      );
      upgradeSeven(this.state);
    }
    if (this.state.schema !== 4 || !this.state.settings.theme || !this.state.settings.hubTab) {
      await this.storage.atomic(`pre-studio-${Date.now()}.json`, this.state);
      this.state.schema = 4;
      this.state.settings.theme ??= "system";
      this.state.settings.hubTab ??= this.state.settings.lastTab;
    }
    this.recovered = loaded.recovered || !this.state.cleanExit;
    const checkpoint = await this.storage.readCheckpoint();
    if (
      checkpoint?.sessionId === this.state.timer.id &&
      checkpoint.revision === this.state.revision &&
      Number.isFinite(checkpoint.remainingMs) &&
      checkpoint.remainingMs >= 0 &&
      checkpoint.remainingMs <= this.state.timer.remainingMs
    ) {
      this.state.timer.remainingMs = checkpoint.remainingMs;
      if (
        Number.isFinite(checkpoint.reminderRemainingMs) &&
        checkpoint.reminderRemainingMs >= 0
      )
        this.state.reminderRemainingMs = checkpoint.reminderRemainingMs;
    }
    if (this.recovered) this.state.timer.intent = false;
    this.state.cleanExit = false;
    await this.storage.save(this.state);
    this.last = this.mono();
    this.checkpointAt = this.last;
  }
  snapshot(): Snapshot {
    return {
      state: copy(this.state),
      blockers: [...this.blockers],
      error: this.error,
      recovered: this.recovered,
      undoWater:
        this.undoWater &&
        this.state.drinks.some((d) => d.id === this.undoWater!.id)
          ? { ...this.undoWater }
          : null,
      undoTimerUntil: this.undoTimer?.until ?? null,
    };
  }
  private emitState() {
    this.emit("state", this.snapshot());
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private async commit(next: State) {
    next.revision = this.state.revision + 1;
    try {
      await this.storage.save(next, this.state);
    } catch (error) {
      this.fail(error);
      throw error;
    }
    this.state = next;
    this.error = null;
    this.blockers.delete("storage");
  }
  private fail(error: unknown) {
    this.error = error instanceof Error ? error.message : String(error);
    this.blockers.add("storage");
    this.emitState();
  }
  private async advance() {
    const now = this.mono();
    const delta = Math.max(0, now - this.last);
    this.last = now;
    if (this.blockers.size) return;
    const s = copy(this.state),
      date = localDate(this.now());
    let dirty = false;
    if (s.reminderDate !== date) {
      s.reminderDate = date;
      s.reminderRemainingMs = s.settings.reminderMinutes * 60_000;
      s.dailyGoals[date] ??= s.settings.goalMl;
      dirty = true;
    }
    if (s.onboarded) {
      s.reminderRemainingMs = Math.max(0, s.reminderRemainingMs - delta);
      if (s.timer.intent) {
        s.timer.remainingMs -= delta;
        while (s.timer.remainingMs <= 0) {
          const overshoot = -s.timer.remainingMs;
          s.sessions.push({
            id: s.timer.id,
            phase: s.timer.phase,
            elapsedMs: s.timer.phase === "focus" ? FOCUS : REST,
            endedAt: this.now().toISOString(),
            status: "completed",
          });
          const phase = s.timer.phase === "focus" ? "rest" : "focus";
          s.timer = {
            ...newTimer(this.now()),
            phase,
            remainingMs: (phase === "focus" ? FOCUS : REST) - overshoot,
          };
          dirty = true;
        }
      }
    }
    if (dirty) {
      await this.commit(s);
    } else {
      this.state = s;
    }
    if (now - this.checkpointAt >= 15000) {
      await this.storage.checkpoint({
        sessionId: s.timer.id,
        revision: this.state.revision,
        remainingMs: s.timer.remainingMs,
        reminderRemainingMs: s.reminderRemainingMs,
      });
      this.checkpointAt = now;
    }
  }
  tick() {
    return this.serial(async () => {
      try {
        await this.advance();
        this.emitState();
      } catch (e) {
        this.fail(e);
      }
    });
  }
  block(reason: Exclude<Blocker, "storage">, blocked: boolean) {
    return this.serial(async () => {
      try {
        await this.advance();
        if (blocked) this.blockers.add(reason);
        else this.blockers.delete(reason);
        this.last = this.mono();
        await this.storage.checkpoint({
          sessionId: this.state.timer.id,
          revision: this.state.revision,
          remainingMs: this.state.timer.remainingMs,
          reminderRemainingMs: this.state.reminderRemainingMs,
        });
        this.emitState();
      } catch (e) {
        this.fail(e);
      }
    });
  }
  command(c: Command) {
    return this.serial(async () => {
      if (
        !c ||
        typeof c.id !== "string" ||
        c.id.length > 100 ||
        typeof c.type !== "string"
      )
        throw Error("Invalid command");
      if (this.state.processed.includes(c.id)) return this.snapshot();
      if (this.blockers.has("storage") && c.type !== "storage.retry")
        throw Error(this.error ?? "Storage unavailable");
      try {
        await this.advance();
        const s = copy(this.state),
          now = this.now(),
          date = localDate(now),
          at = now.toISOString();
        let nextUndo = this.undoTimer;
        let deletedRecord: {
          key: string;
          kind: "task" | "note";
          value: any;
        } | null = null;
        if (c.type.startsWith("timer.") && c.type !== "timer.undo")
          nextUndo = null;
        switch (c.type) {
          case "onboard":
            s.onboarded = true;
            s.timer = newTimer(now);
            break;
          case "timer.pause":
            s.timer.intent = false;
            break;
          case "timer.resume":
            s.timer.intent = true;
            break;
          case "timer.reset": {
            const old = copy(s.timer);
            const elapsed =
              (old.phase === "focus" ? FOCUS : REST) - old.remainingMs;
            if (elapsed > 0)
              s.sessions.push({
                id: old.id,
                phase: old.phase,
                elapsedMs: elapsed,
                endedAt: at,
                status: "interrupted",
              });
            s.timer = newTimer(now);
            nextUndo = {
              timer: old,
              sessionId: old.id,
              until: now.getTime() + 10000,
            };
            break;
          }
          case "timer.undo":
            if (!this.undoTimer || now.getTime() > this.undoTimer.until)
              throw Error("Reset undo has expired");
            s.timer = { ...this.undoTimer.timer, intent: false };
            s.sessions = s.sessions.filter(
              (x) => x.id !== this.undoTimer!.sessionId,
            );
            nextUndo = null;
            break;
          case "water.add": {
            const ml = c.ml ?? s.settings.quickMl;
            if (ml !== 350 && ml !== 1000) throw Error("Choose 350 mL or 1 L");
            s.drinks.push({
              id: c.id,
              ml,
              at,
              date,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            s.dailyGoals[date] ??= s.settings.goalMl;
            s.reminderRemainingMs = s.settings.reminderMinutes * 60000;
            break;
          }
          case "water.delete": {
            const item = s.drinks.find((d) => d.id === c.itemId);
            if (!item) throw Error("Drink not found");
            s.drinks = s.drinks.filter((d) => d.id !== c.itemId);
            if (item.date === date)
              s.reminderRemainingMs = s.settings.reminderMinutes * 60000;
            break;
          }
          case "water.snooze":
            s.reminderRemainingMs = 900000;
            break;
          case "asset.remove": {
            const library = s.settings.charms!;
            if (c.revision !== library.revision)
              throw Error("Library changed. Reload before removing.");
            if (
              Object.values(library.slots).some(
                (slot) => slot.asset === c.assetId,
              )
            )
              throw Error("Remove this asset from its slots first.");
            library.assets = library.assets.filter((a) => a.id !== c.assetId);
            library.revision++;
            // Bytes remain available for managed recovery backups until reset-all.
            break;
          }
          case "charms.save": {
            const old = s.settings.charms!;
            if (c.revision !== old.revision)
              throw Error(
                "Charms changed in another window. Your draft is preserved. Reload before applying.",
              );
            const next = structuredClone(c.library) as CharmLibrary;
            // Clients cannot invent asset records; imports register through the asset service.
            next.assets = old.assets;
            validateLibrary(next);
            if (next.version !== 2)
              throw Error("Reopen Charme to edit the seven-charm layout.");
            next.revision = old.revision + 1;
            if (c.appearance !== undefined) {
              const current = s.settings.appearance ?? defaultAppearance();
              if (c.appearanceRevision !== current.revision)
                throw Error(
                  "Layout changed in another window. Your draft is preserved.",
                );
              const appearance = structuredClone(c.appearance) as Appearance;
              validateAppearance(appearance);
              if (appearance.version !== 2)
                throw Error("Reopen Charme to edit the seven-charm layout.");
              appearance.revision = current.revision + 1;
              s.settings.appearance = appearance;
            }

            validateLayoutEnvelope(
              s.settings.appearance ?? defaultAppearance(),
              { ...s.settings, charms: next },
            );
            s.settings.charms = next;
            break;
          }
          case "appearance.save": {
            const current = s.settings.appearance ?? defaultAppearance();
            if (c.revision !== current.revision)
              throw Error(
                "Appearance changed in another window. Your draft is preserved; reload before applying.",
              );
            const next = structuredClone(c.appearance) as Appearance;
            validateLayoutEnvelope(next, s.settings);
            next.revision = current.revision + 1;
            s.settings.appearance = next;
            break;
          }
          case "settings": {
            if (
              !c.patch ||
              typeof c.patch !== "object" ||
              Array.isArray(c.patch)
            )
              throw Error("Invalid settings");
            const patch = c.patch as Partial<State["settings"]>;
            if (c.expected && typeof c.expected === "object")
              for (const [key, value] of Object.entries(c.expected)) {
                if (
                  !Object.hasOwn(s.settings, key) ||
                  s.settings[key as keyof State["settings"]] !== value
                )
                  throw Error(
                    "Setting changed in another window. Your edit is preserved.",
                  );
              }
            if ("appearance" in patch || "charms" in patch)
              throw Error("Use the layout editor to save appearance");
            if (
              Object.keys(patch).some(
                (k) =>
                  !Object.hasOwn(s.settings, k) &&
                  !["theme", "hubTab"].includes(k),
              )
            )
              throw Error("Unknown preference");
            s.settings = { ...s.settings, ...patch };
            validateSettings(s.settings);
            if (patch.goalMl !== undefined)
              s.dailyGoals[date] = s.settings.goalMl;
            if (
              patch.reminderMinutes !== undefined ||
              patch.reminders !== undefined
            )
              s.reminderRemainingMs = s.settings.reminderMinutes * 60000;
            break;
          }
          case "task.add": {
            const value = text(c.text, 10000).trim();
            if (!value) throw Error("Write a task first");
            s.tasks.unshift({
              id: c.id,
              text: value,
              done: false,
              revision: 1,
              updatedAt: at,
            });
            break;
          }
          case "task.update": {
            const t = s.tasks.find((t) => t.id === c.itemId);
            if (!t || t.revision !== c.revision)
              throw Error(
                "This task changed elsewhere. Reload before editing.",
              );
            if (c.text !== undefined) {
              t.text = text(c.text, 10000).trim();
              if (!t.text) throw Error("Task cannot be empty");
            }
            if (c.done !== undefined) {
              if (typeof c.done !== "boolean")
                throw Error("Invalid task status");
              t.done = c.done;
            }
            t.revision++;
            t.updatedAt = at;
            break;
          }
          case "note.add":
            s.notes.unshift({
              id: c.id,
              title: text(c.title ?? "Untitled", 200),
              body: text(c.body ?? "", 1000000),
              revision: 1,
              updatedAt: at,
            });
            break;
          case "note.update": {
            const n = s.notes.find((n) => n.id === c.itemId);
            if (!n || n.revision !== c.revision)
              throw Error(
                "This note changed or was deleted elsewhere. Save your draft as a copy.",
              );
            n.title = text(c.title, 200);
            n.body = text(c.body, 1000000);
            n.revision++;
            n.updatedAt = at;
            break;
          }
          case "task.delete":
          case "note.delete": {
            const kind = c.type === "task.delete" ? "task" : "note";
            const list = kind === "task" ? s.tasks : s.notes;
            const value = list.find((x) => x.id === c.itemId);
            if (!value || value.revision !== c.revision)
              throw Error("Item changed elsewhere");
            deletedRecord = { key: c.id, kind, value: copy(value) };
            if (kind === "task")
              s.tasks = s.tasks.filter((x) => x.id !== c.itemId);
            else s.notes = s.notes.filter((x) => x.id !== c.itemId);
            break;
          }
          case "item.undo": {
            const old = this.deleted.get(String(c.deleteId));
            if (!old) throw Error("Undo is no longer available");
            if (old.kind === "task") {
              if (!s.tasks.some((x) => x.id === old.value.id))
                s.tasks.unshift(old.value as State["tasks"][number]);
            } else if (!s.notes.some((x) => x.id === old.value.id))
              s.notes.unshift(old.value as State["notes"][number]);
            break;
          }
          case "storage.retry":
            break;
          default:
            throw Error("Unknown command");
        }
        s.processed.push(c.id);
        s.processed = s.processed.slice(-2000);
        await this.commit(s);
        this.undoTimer = nextUndo;
        if (c.type === "water.add")
          this.undoWater = { id: c.id, until: this.now().getTime() + 30000 };
        if (c.type === "water.delete" && c.itemId === this.undoWater?.id)
          this.undoWater = null;
        if (deletedRecord)
          this.deleted.set(deletedRecord.key, {
            kind: deletedRecord.kind,
            value: deletedRecord.value,
          });
        if (c.type === "item.undo") this.deleted.delete(String(c.deleteId));
        this.emitState();
        return this.snapshot();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code) this.fail(e);
        throw e;
      }
    });
  }
  async restore(value: unknown) {
    return this.serial(() => this.restoreState(value));
  }
  private async restoreState(value: unknown) {
    const s = validateState(value);
    upgradeSeven(s);
    s.settings.charms ??= migrateLibrary(s.settings);
    s.settings.charms.revision =
      (this.state.settings.charms?.revision ?? 0) + 1;
    if (s.settings.appearance)
      s.settings.appearance.revision =
        (this.state.settings.appearance?.revision ?? 0) + 1;
    await this.storage.atomic(`pre-restore-${Date.now()}.json`, this.state);
    s.timer.intent = false;
    s.cleanExit = false;
    s.timer.id = crypto.randomUUID();
    const floor = Math.max(
      0,
      ...this.state.tasks.map((x) => x.revision),
      ...this.state.notes.map((x) => x.revision),
    );
    for (const item of [...s.tasks, ...s.notes])
      item.revision = Math.max(floor, item.revision) + 1;
    s.processed = [];
    await this.commit(s);
    this.deleted.clear();
    this.undoTimer = null;
    this.undoWater = null;
    this.last = this.mono();
    this.emitState();
  }
  async resetAll() {
    return this.serial(async () => {
      const next = initialState(this.now());
      next.cleanExit = false;
      next.revision = this.state.revision + 1;
      await this.storage.atomic("state.json", next);
      this.state = next;
      this.undoTimer = null;
      this.undoWater = null;
      this.deleted.clear();
      try {
        for (const name of await readdir(this.storage.directory)) {
          if (
            name === "backup.json" ||
            name === "checkpoint.json" ||
            name === "window.json" ||
            /^(pre-restore|pre-upgrade|pre-seven-charms|damaged)-[0-9]+\.json$/.test(
              name,
            )
          )
            await unlink(this.storage.file(name));
        }
      } catch (error) {
        this.fail(error);
        throw error;
      }
      await this.assets.clear();
      this.last = this.mono();
      this.emitState();
    });
  }
  async close() {
    return this.serial(async () => {
      try {
        await this.advance();
        const s = copy(this.state);
        s.cleanExit = true;
        await this.commit(s);
      } catch (e) {
        this.fail(e);
        throw e;
      }
    });
  }
}

function upgradeSeven(s: State) {
  s.schema = 4;
  s.settings.theme ??= "system";
  s.settings.hubTab ??= s.settings.lastTab;
  s.settings.charms ??= migrateLibrary(s.settings);
  const library = s.settings.charms;
  library.slots.extra2 ??= emptySlot();
  library.slots.extra3 ??= emptySlot();
  if (
    library.notice?.includes("unassigned") &&
    s.settings.name &&
    !Object.values(library.slots).some((slot) => slot.asset === "tag")
  ) {
    library.slots.extra2 = {
      ...emptySlot("tag"),
      name: s.settings.name,
      nameStyle: s.settings.nameStyle,
      nameColor: s.settings.neonColor,
    };
    library.notice = "Your preserved name tag is now assigned to Slot D.";
  }
  library.version = 2;
  const defaults = defaultAppearance();
  s.settings.appearance ??= defaults;
  const a = s.settings.appearance;
  for (const id of ["extra2", "extra3"] as const) {
    a.scales[id] ??= defaults.scales[id];
    a.links[id] ??= defaults.links[id];
  }
  a.version = 2;
}
