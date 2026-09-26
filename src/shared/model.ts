import { type CharmLibrary, validateLibrary, migrateLibrary } from "./library";
import {
  defaultAppearance,
  validateAppearance,
  type Appearance,
} from "./appearance";
import { decorations } from "./charms";
export const FOCUS = 45 * 60_000,
  REST = 15 * 60_000;
export type Blocker = "sleep" | "lock" | "inactive" | "storage";
export interface Timer {
  id: string;
  phase: "focus" | "rest";
  remainingMs: number;
  intent: boolean;
  startedAt: string;
}
export interface Task {
  id: string;
  text: string;
  done: boolean;
  revision: number;
  updatedAt: string;
}
export interface Note {
  id: string;
  title: string;
  body: string;
  revision: number;
  updatedAt: string;
}
export interface Drink {
  id: string;
  ml: 350 | 1000;
  at: string;
  date: string;
  timezone: string;
}
export interface Session {
  id: string;
  phase: "focus" | "rest";
  elapsedMs: number;
  endedAt: string;
  status: "completed" | "interrupted";
}
export interface Settings {
  charms?: CharmLibrary;
  appearance?: Appearance;
  goalMl: number;
  quickMl: 350 | 1000;
  reminderMinutes: number;
  reminders: boolean;
  name: string;
  nameStyle: "metal" | "neon";
  neonColor: string;
  decoration: "duck" | "car";
  extras: (string | null)[];
  scale: "small" | "medium" | "large";
  alwaysOnTop: boolean;
  reducedMotion: boolean;
  launchAtLogin: boolean;
  notifications: boolean;
  sound: boolean;
  theme?: "system" | "light" | "dark";
  hubTab?:
    | "dashboard"
    | "tasks"
    | "notes"
    | "charms"
    | "settings"
    | "controls"
    | "layout";
  lastTab: "tasks" | "notes";
}
export interface State {
  schema: 1 | 2 | 3 | 4;
  revision: number;
  onboarded: boolean;
  settings: Settings;
  timer: Timer;
  tasks: Task[];
  notes: Note[];
  drinks: Drink[];
  sessions: Session[];
  dailyGoals: Record<string, number>;
  reminderRemainingMs: number;
  reminderDate: string;
  processed: string[];
  cleanExit: boolean;
}
export interface Snapshot {
  state: State;
  blockers: Blocker[];
  error: string | null;
  recovered: boolean;
  undoWater?: { id: string; until: number } | null;
  undoTimerUntil: number | null;
}
export type Command = { id: string; type: string; [key: string]: unknown };
export function localDate(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function newTimer(now: Date): Timer {
  return {
    id: crypto.randomUUID(),
    phase: "focus",
    remainingMs: FOCUS,
    intent: true,
    startedAt: now.toISOString(),
  };
}
export function initialState(now = new Date()): State {
  return {
    schema: 4,
    revision: 0,
    onboarded: false,
    settings: {
      charms: migrateLibrary({
        decoration: "duck",
        extras: [null, null],
        name: "",
      }),
      appearance: defaultAppearance(),
      goalMl: 1750,
      quickMl: 350,
      reminderMinutes: 60,
      reminders: true,
      name: "",
      nameStyle: "neon",
      neonColor: "#9cf6d3",
      decoration: "duck",
      extras: [null, null],
      scale: "medium",
      alwaysOnTop: true,
      reducedMotion: false,
      launchAtLogin: false,
      notifications: false,
      sound: false,
      lastTab: "tasks",
      hubTab: "tasks",
      theme: "system",
    },
    timer: newTimer(now),
    tasks: [],
    notes: [],
    drinks: [],
    sessions: [],
    dailyGoals: { [localDate(now)]: 1750 },
    reminderRemainingMs: 3600000,
    reminderDate: localDate(now),
    processed: [],
    cleanExit: true,
  };
}
export function waterTotal(s: State, date = localDate(new Date())) {
  return s.drinks.filter((d) => d.date === date).reduce((n, d) => n + d.ml, 0);
}
export function validateState(value: unknown): State {
  const s = value as State;
  if (!s || ![1, 2, 3, 4].includes(s.schema))
    throw Error(
      "Unsupported backup version. Your original file has been preserved.",
    );
  if (
    !Number.isSafeInteger(s.revision) ||
    typeof s.onboarded !== "boolean" ||
    typeof s.cleanExit !== "boolean"
  )
    throw Error("Invalid state header");
  validateSettings(s.settings);
  if (
    !s.timer ||
    typeof s.timer.id !== "string" ||
    !["focus", "rest"].includes(s.timer.phase) ||
    !Number.isFinite(s.timer.remainingMs) ||
    s.timer.remainingMs < 0 ||
    s.timer.remainingMs > (s.timer.phase === "focus" ? FOCUS : REST) ||
    typeof s.timer.intent !== "boolean" ||
    !validDate(s.timer.startedAt)
  )
    throw Error("Invalid timer");
  for (const key of [
    "tasks",
    "notes",
    "drinks",
    "sessions",
    "processed",
  ] as const)
    if (!Array.isArray(s[key])) throw Error(`Invalid ${key}`);
  if (
    s.tasks.some(
      (t) =>
        !t ||
        typeof t.id !== "string" ||
        typeof t.text !== "string" ||
        t.text.length > 10000 ||
        typeof t.done !== "boolean" ||
        !Number.isInteger(t.revision) ||
        !validDate(t.updatedAt),
    )
  )
    throw Error("Invalid tasks");
  if (
    s.notes.some(
      (n) =>
        !n ||
        typeof n.id !== "string" ||
        typeof n.title !== "string" ||
        typeof n.body !== "string" ||
        n.title.length > 200 ||
        n.body.length > 1000000 ||
        !Number.isInteger(n.revision) ||
        !validDate(n.updatedAt),
    )
  )
    throw Error("Invalid notes");
  if (
    s.drinks.some(
      (d) =>
        !d ||
        typeof d.id !== "string" ||
        ![350, 1000].includes(d.ml) ||
        !validDate(d.at) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
        typeof d.timezone !== "string",
    )
  )
    throw Error("Invalid water history");
  if (
    s.sessions.some(
      (x) =>
        !x ||
        typeof x.id !== "string" ||
        !["focus", "rest"].includes(x.phase) ||
        !["completed", "interrupted"].includes(x.status) ||
        !Number.isFinite(x.elapsedMs) ||
        x.elapsedMs < 0 ||
        !validDate(x.endedAt),
    )
  )
    throw Error("Invalid session history");
  if (
    !s.dailyGoals ||
    typeof s.dailyGoals !== "object" ||
    Array.isArray(s.dailyGoals) ||
    Object.entries(s.dailyGoals).some(
      ([k, v]) => !/^\d{4}-\d{2}-\d{2}$/.test(k) || !validGoal(v),
    )
  )
    throw Error("Invalid daily goals");
  if (
    !Number.isFinite(s.reminderRemainingMs) ||
    s.reminderRemainingMs < 0 ||
    typeof s.reminderDate !== "string" ||
    s.processed.some((x) => typeof x !== "string")
  )
    throw Error("Invalid reminder");
  for (const list of [s.tasks, s.notes, s.drinks, s.sessions])
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw Error("Duplicate record identifiers");
  return structuredClone(s);
}
function validDate(s: unknown) {
  return typeof s === "string" && Number.isFinite(Date.parse(s));
}
function validGoal(n: unknown) {
  return (
    Number.isInteger(n) &&
    Number(n) >= 50 &&
    Number(n) <= 10000 &&
    Number(n) % 50 === 0
  );
}
export function validateSettings(s: Settings) {
  if (!s) throw Error("Invalid settings");
  if (s.charms) validateLibrary(s.charms);
  if (s.appearance) validateAppearance(s.appearance, s);
  if (
    !s ||
    !validGoal(s.goalMl) ||
    ![350, 1000].includes(s.quickMl) ||
    !Number.isInteger(s.reminderMinutes) ||
    s.reminderMinutes < 1 ||
    s.reminderMinutes > 240
  )
    throw Error("Invalid water settings");
  if (
    typeof s.name !== "string" ||
    [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        s.name,
      ),
    ].length > 24 ||
    !["metal", "neon"].includes(s.nameStyle) ||
    !/^#[0-9a-f]{6}$/i.test(s.neonColor)
  )
    throw Error("Invalid name settings");
  if (
    (s.theme !== undefined && !["system", "light", "dark"].includes(s.theme)) ||
    (s.hubTab !== undefined &&
      ![
        "dashboard",
        "tasks",
        "notes",
        "charms",
        "settings",
        "controls",
        "layout",
      ].includes(s.hubTab)) ||
    !["duck", "car"].includes(s.decoration) ||
    !["small", "medium", "large"].includes(s.scale) ||
    !["tasks", "notes"].includes(s.lastTab) ||
    !Array.isArray(s.extras) ||
    s.extras.length !== 2 ||
    s.extras.some((x) => x !== null && !decorations.some((c) => c.id === x))
  )
    throw Error("Invalid charm settings");
  for (const k of [
    "alwaysOnTop",
    "reducedMotion",
    "launchAtLogin",
    "notifications",
    "sound",
    "reminders",
  ] as const)
    if (typeof s[k] !== "boolean") throw Error("Invalid preference");
}
