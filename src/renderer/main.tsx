import { DialogHost, ask } from "./Dialog";
import { CharmManager } from "./CharmManager";
const StudioProof = lazy(() =>
  import("./StudioProof").then((m) => ({ default: m.StudioProof })),
);
const ImportPreview = lazy(() =>
  import("./ImportPreview").then((m) => ({ default: m.ImportPreview })),
);
import type { CharmLibrary } from "../shared/library";
import { restoreFile } from "./api";
import { flushEdits, registerWriter } from "./flush";
import { SyncedInput } from "./SyncedInput";
const SceneProof = lazy(() =>
  import("./SceneProof").then((m) => ({ default: m.SceneProof })),
);
import { AccessibilityAudit } from "./AccessibilityAudit";
import { LayoutEditor } from "./LayoutEditor";
import { Controls } from "./Controls";
import type { Appearance } from "../shared/appearance";
const AssetProof = lazy(() =>
  import("./AssetProof").then((m) => ({ default: m.AssetProof })),
);
const SceneWidget = lazy(() =>
  import("./SceneWidget").then((m) => ({ default: m.SceneWidget })),
);
import buildInfo from "../shared/build.json";
import { acknowledgeDraft } from "../shared/draft";
import { decorations, charmById } from "../shared/charms";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FOCUS,
  REST,
  localDate,
  waterTotal,
  type Snapshot,
  type Note,
  type Settings,
} from "../shared/model";
import {
  initialize,
  subscribe,
  command,
  action,
  restore,
  resetAll,
} from "./api";
import "./style.css";
import "./studio.css";
const view = new URLSearchParams(location.search).get("view") ?? "dashboard";
const format = (ms: number) =>
  `${Math.floor(Math.ceil(ms / 1000) / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(Math.ceil(ms / 1000) % 60).toString().padStart(2, "0")}`;
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [tab, setTab] = useState(view === "widget" ? "tasks" : view),
    [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Appearance | null>(null);
  const [libraryPreview, setLibraryPreview] = useState<CharmLibrary | null>(
    null,
  );
  useEffect(() => {
    const preference = snapshot?.state.settings.theme ?? "system";
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preference === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preference;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [snapshot?.state.settings.theme]);
  useEffect(() => {
    if (
      !snapshot ||
      view === "widget" ||
      ![
        "dashboard",
        "tasks",
        "notes",
        "charms",
        "settings",
        "controls",
        "layout",
      ].includes(tab) ||
      snapshot.state.settings.hubTab === tab
    )
      return;
    void command("settings", {
      patch: {
        hubTab: tab,
        ...(tab === "tasks" || tab === "notes" ? { lastTab: tab } : {}),
      },
    })
      .then(setSnapshot)
      .catch((e) => setError(e.message));
  }, [tab, !!snapshot]);
  useEffect(() => window.charme?.onLibraryPreview(setLibraryPreview), []);
  useEffect(() => window.charme?.onPreview(setPreview), []);
  useEffect(() => window.charme?.onFlush(flushEdits), []);
  useEffect(() => {
    if (view === "widget") return;
    const escape = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        document.querySelector("dialog[open]")
      )
        return;
      e.preventDefault();
      void flushEdits()
        .then(() => action("close"))
        .catch((e) => setError(e.message));
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    initialize()
      .then((s) => {
        setSnapshot(s);
        setConnected(true);
        void subscribe(
          (s) => {
            setSnapshot(s);
            setConnected(true);
          },
          () => setConnected(false),
          controller.signal,
        );
      })
      .catch((e) => setError(e.message));
    return () => controller.abort();
  }, []);
  useEffect(
    () =>
      window.charme?.onNavigate((next) => {
        if (
          [
            "tasks",
            "notes",
            "settings",
            "dashboard",
            "controls",
            "layout",
            "charms",
          ].includes(next)
        )
          void flushEdits()
            .then(() => setTab(next))
            .catch((e) => setError(e.message));
      }),
    [],
  );
  async function send(
    type: string,
    data: Record<string, unknown> = {},
    id?: string,
  ) {
    try {
      const s = await command(type, data, id);
      setSnapshot(s);
      setError("");
      return s;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }
  if (!snapshot)
    return (
      <div className="startup">
        <h1>
          Charme<span>◌</span>
        </h1>
        <p>{error || "Waking up your little rituals…"}</p>
        {error && <button onClick={() => location.reload()}>Retry</button>}
      </div>
    );
  const s = snapshot.state;
  if (view === "widget")
    return (
      <>
        <Suspense
          fallback={<div className="startup">Loading your charms…</div>}
        >
          <SceneWidget
            snapshot={
              libraryPreview
                ? {
                    ...snapshot,
                    state: {
                      ...snapshot.state,
                      settings: {
                        ...snapshot.state.settings,
                        charms: libraryPreview,
                      },
                    },
                  }
                : snapshot
            }
            send={send}
            appearance={preview ?? undefined}
            editing={!!preview || !!libraryPreview}
          />
        </Suspense>
        {(error || snapshot.error) && (
          <aside className="widget-error" data-hit>
            {error || snapshot.error}
            <button onClick={() => void send("storage.retry").catch(() => {})}>
              Retry save
            </button>
          </aside>
        )}
      </>
    );
  return (
    <main className="dashboard">
      <header>
        <div>
          <span className="eyebrow">YOUR DAILY COLLECTION</span>
          <h1>
            Charme<span>◌</span>
          </h1>
        </div>
        <div className="connection">
          {connected
            ? "Connected · local storage"
            : "Disconnected · Reopen Dashboard from Charme"}
        </div>
      </header>
      <nav aria-label="Main navigation">
        {["dashboard", "tasks", "notes", "charms", "settings"].map((x) => (
          <button
            key={x}
            className={tab === x ? "selected" : ""}
            aria-current={tab === x ? "page" : undefined}
            onClick={async () => {
              try {
                await flushEdits();
              } catch (e) {
                setError((e as Error).message);
                return;
              }
              setTab(x);
            }}
          >
            {x === "dashboard" ? "Today" : x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </nav>
      {(error || snapshot.error) && (
        <div role="alert" className="error">
          {error || snapshot.error}
          <button onClick={() => void send("storage.retry").catch(() => {})}>
            Retry
          </button>
        </div>
      )}
      {snapshot.recovered && (
        <p className="banner">
          Recovered from an interrupted session. Your timer is paused.
        </p>
      )}
      <fieldset disabled={!connected} className="content">
        {tab === "settings" && (
          <section className="studio-preferences">
            <h2>Settings</h2>
            <label>
              Appearance
              <select
                value={s.settings.theme ?? "system"}
                onChange={(e) =>
                  void send("settings", {
                    patch: { theme: e.target.value },
                  }).catch(() => {})
                }
              >
                <option value="system">Follow system</option>
                <option value="light">Ivory</option>
                <option value="dark">Charcoal</option>
              </select>
            </label>
            <button onClick={() => setTab("controls")}>
              Open accessible controls
            </button>
          </section>
        )}
        {tab === "controls" && (
          <button onClick={() => setTab("settings")}>Back to Settings</button>
        )}
        {tab === "layout" && (
          <button onClick={() => setTab("charms")}>Back to Charms</button>
        )}
        {tab === "dashboard" && (
          <>
            <div className="intro">
              <span className="eyebrow">
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <h2>
                A little care.
                <br />A little focus.
              </h2>
              <p>Your rituals, at your own pace.</p>
            </div>
            <div className="summary">
              <section>
                <span className="eyebrow">{s.timer.phase.toUpperCase()}</span>
                <div className="big-time">{format(s.timer.remainingMs)}</div>
                <button
                  onClick={() =>
                    void send(
                      s.timer.intent ? "timer.pause" : "timer.resume",
                    ).catch(() => {})
                  }
                >
                  {s.timer.intent ? "Pause" : "Resume"}
                </button>
                <button
                  className="quiet"
                  onClick={() => void send("timer.reset").catch(() => {})}
                >
                  Reset
                </button>
              </section>
              <section>
                <span className="eyebrow">WATER TODAY</span>
                <h3>
                  {(waterTotal(s) / 1000).toFixed(2)}
                  <small>
                    {" "}
                    /{" "}
                    {(s.dailyGoals[localDate(new Date())] ??
                      s.settings.goalMl) / 1000}{" "}
                    L
                  </small>
                </h3>
                <progress
                  aria-label="Daily hydration progress"
                  value={waterTotal(s)}
                  max={s.dailyGoals[localDate(new Date())] ?? s.settings.goalMl}
                />
                <div className="row">
                  <button
                    onClick={() =>
                      void send("water.add", { ml: 350 }).catch(() => {})
                    }
                  >
                    + 350 mL
                  </button>
                  <button
                    onClick={() =>
                      void send("water.add", { ml: 1000 }).catch(() => {})
                    }
                  >
                    + 1 L
                  </button>
                </div>
              </section>
            </div>
            <h3>Drink history</h3>
            {!s.drinks.length ? (
              <p className="muted">Your first sip starts the story.</p>
            ) : (
              s.drinks
                .slice()
                .reverse()
                .slice(0, 30)
                .map((d) => (
                  <div className="history" key={d.id}>
                    <span>{d.ml} mL</span>
                    <span>
                      {d.date} ·{" "}
                      {new Date(d.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <button
                      className="quiet"
                      onClick={() =>
                        void send("water.delete", { itemId: d.id }).catch(
                          () => {},
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))
            )}
            <h3>Focus history</h3>
            {s.sessions.length ? (
              s.sessions
                .slice()
                .reverse()
                .slice(0, 30)
                .map((x) => (
                  <div className="history" key={x.id}>
                    <span>
                      {x.phase} · {x.status}
                    </span>
                    <span>{Math.round(x.elapsedMs / 60000)} min</span>
                    <span>{new Date(x.endedAt).toLocaleDateString()}</span>
                  </div>
                ))
            ) : (
              <p className="muted">
                Completed and interrupted sessions will appear here.
              </p>
            )}
          </>
        )}
        {tab === "charms" && <CharmManager snapshot={snapshot} send={send} />}
        {tab === "layout" && <LayoutEditor snapshot={snapshot} send={send} />}
        {tab === "controls" && <Controls snapshot={snapshot} send={send} />}
        {tab === "tasks" && <Tasks snapshot={snapshot} send={send} />}
        {tab === "notes" && <Notes snapshot={snapshot} send={send} />}
        {tab === "settings" && <Preferences snapshot={snapshot} send={send} />}
      </fieldset>
      <footer>
        <span>Small rituals. All yours.</span>
        <button
          className="quiet"
          onClick={() =>
            void action("export").catch((e) => setError(e.message))
          }
        >
          Export backup
        </button>
        {window.charme ? (
          <>
            <button className="quiet" onClick={() => void action("restore")}>
              Restore
            </button>
            <button className="quiet" onClick={() => void action("data")}>
              Data folder
            </button>
          </>
        ) : (
          <label className="file-button">
            Restore
            <input
              type="file"
              accept=".json,.charme"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (
                  file &&
                  (await ask(
                    "Restore backup?",
                    "Replace your data? A pre-restore backup will be kept.",
                    [
                      { label: "Keep current data", value: "cancel" },
                      { label: "Restore backup", value: "restore" },
                    ],
                  )) === "restore"
                )
                  try {
                    await restoreFile(file);
                    setNotice("Backup restored. Timer paused.");
                  } catch (error) {
                    setError((error as Error).message);
                  }
              }}
            />
          </label>
        )}
      </footer>
      {notice && <p role="status">{notice}</p>}
    </main>
  );
}

type Send = (
  type: string,
  data?: Record<string, unknown>,
  id?: string,
) => Promise<Snapshot>;
function Tasks({ snapshot, send }: { snapshot: Snapshot; send: Send }) {
  const [draft, setDraft] = useState(""),
    [undo, setUndo] = useState<string>();
  return (
    <section>
      <h2>Make a little room.</h2>
      <p className="muted">One thing at a time.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void send("task.add", { text: draft })
            .then(() => setDraft(""))
            .catch(() => {});
        }}
      >
        <input
          aria-label="New task"
          placeholder="What’s on your mind?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button>Add task</button>
      </form>
      {!snapshot.state.tasks.length && (
        <p className="empty">A clear page. A fresh start.</p>
      )}
      {[...snapshot.state.tasks]
        .sort((a, b) => Number(a.done) - Number(b.done))
        .map((t) => (
          <div className="task" key={t.id}>
            <input
              type="checkbox"
              checked={t.done}
              aria-label={`${t.done ? "Reopen" : "Complete"} ${t.text}`}
              onChange={() =>
                void send("task.update", {
                  itemId: t.id,
                  revision: t.revision,
                  done: !t.done,
                }).catch(() => {})
              }
            />
            <textarea
              key={`${t.id}-${t.revision}`}
              aria-label={`Task: ${t.text}`}
              className={t.done ? "done" : ""}
              defaultValue={t.text}
              onBlur={(e) => {
                if (e.target.value !== t.text)
                  void send("task.update", {
                    itemId: t.id,
                    revision: t.revision,
                    text: e.target.value,
                  }).catch(() => {});
              }}
            />
            <button
              className="quiet"
              onClick={() => {
                const id = crypto.randomUUID();
                void send(
                  "task.delete",
                  { itemId: t.id, revision: t.revision },
                  id,
                )
                  .then(() => setUndo(id))
                  .catch(() => {});
              }}
            >
              Delete
            </button>
          </div>
        ))}
      {undo && (
        <button
          onClick={() =>
            void send("item.undo", { deleteId: undo })
              .then(() => setUndo(undefined))
              .catch(() => {})
          }
        >
          Undo delete
        </button>
      )}
    </section>
  );
}
function Notes({ snapshot, send }: { snapshot: Snapshot; send: Send }) {
  const [selected, setSelected] = useState<string>(),
    [query, setQuery] = useState(""),
    [undo, setUndo] = useState<string>();
  const cache = useRef(new Map<string, Note>());
  for (const n of snapshot.state.notes) cache.current.set(n.id, n);
  const note =
    snapshot.state.notes.find((n) => n.id === selected) ??
    cache.current.get(selected ?? "");
  return (
    <section>
      <div className="row spread">
        <h2>Keep a thought.</h2>
        <button
          onClick={() => {
            const id = crypto.randomUUID();
            void send("note.add", {}, id).then(() => setSelected(id));
          }}
        >
          New note
        </button>
      </div>
      <input
        aria-label="Search notes"
        placeholder="Find a thought…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="note-list">
        {snapshot.state.notes
          .filter((n) =>
            (n.title + " " + n.body)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((n) => (
            <button
              className={n.id === selected ? "selected" : ""}
              key={n.id}
              onClick={() => setSelected(n.id)}
            >
              {n.title || "Untitled"}
            </button>
          ))}
      </div>
      {note ? (
        <NoteEditor
          key={note.id}
          note={note}
          send={send}
          onDelete={() => {
            const id = crypto.randomUUID();
            void send(
              "note.delete",
              { itemId: note.id, revision: note.revision },
              id,
            ).then(() => {
              setUndo(id);
              setSelected(undefined);
            });
          }}
        />
      ) : (
        <p className="empty">Choose a note, or begin a new one.</p>
      )}
      {undo && (
        <button
          onClick={() =>
            void send("item.undo", { deleteId: undo }).then(() =>
              setUndo(undefined),
            )
          }
        >
          Undo delete
        </button>
      )}
    </section>
  );
}
function NoteEditor({
  note,
  send,
  onDelete,
}: {
  note: Note;
  send: Send;
  onDelete: () => void;
}) {
  const key = `charme-draft-${note.id}`;
  const cached = useRef<{
    title: string;
    body: string;
    revision: number;
  } | null>(null);
  if (cached.current === null) {
    try {
      cached.current = JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {}
  }
  const [title, setTitle] = useState(cached.current?.title ?? note.title),
    [body, setBody] = useState(cached.current?.body ?? note.body),
    [status, setStatus] = useState(
      cached.current ? "Restored unsaved draft" : "Saved",
    );
  const draft = useRef({ title, body }),
    revision = useRef(cached.current?.revision ?? note.revision),
    saved = useRef({ title: note.title, body: note.body }),
    pending = useRef<ReturnType<typeof setTimeout>>(undefined),
    chain = useRef(Promise.resolve()),
    composing = useRef(false);
  draft.current = { title, body };
  const save = () => {
    clearTimeout(pending.current);
    chain.current = chain.current.then(async () => {
      const value = { ...draft.current };
      if (
        value.title === saved.current.title &&
        value.body === saved.current.body
      )
        return;
      setStatus("Saving…");
      try {
        const result = await send("note.update", {
          itemId: note.id,
          revision: revision.current,
          ...value,
        });
        const latest = result.state.notes.find((n) => n.id === note.id)!;
        revision.current = latest.revision;
        const acknowledgement = acknowledgeDraft(
          value,
          draft.current,
          latest.revision,
        );
        saved.current = acknowledgement.saved;
        if (acknowledgement.clean) sessionStorage.removeItem(key);
        else
          sessionStorage.setItem(key, JSON.stringify(acknowledgement.pending));
        setStatus(acknowledgement.clean ? "Saved" : "Unsaved changes");
      } catch {
        setStatus("Could not save. Your draft is kept here.");
      }
    });
    return chain.current;
  };
  useEffect(() => {
    if (
      note.revision !== revision.current &&
      draft.current.title === saved.current.title &&
      draft.current.body === saved.current.body
    ) {
      revision.current = note.revision;
      saved.current = { title: note.title, body: note.body };
      setTitle(note.title);
      setBody(note.body);
    }
  }, [note]);
  useEffect(() => {
    if (title !== saved.current.title || body !== saved.current.body)
      sessionStorage.setItem(
        key,
        JSON.stringify({ title, body, revision: revision.current }),
      );
    if (!composing.current)
      pending.current = setTimeout(() => void save(), 500);
    return () => clearTimeout(pending.current);
  }, [title, body]);
  useEffect(
    () =>
      registerWriter(async () => {
        await save();
        if (
          draft.current.title !== saved.current.title ||
          draft.current.body !== saved.current.body
        ) {
          const choice = await ask(
            "Note could not be saved",
            "Your draft is still here. Keep editing to retry or copy the text. Discarding removes only changes since the last successful save.",
            [
              { label: "Keep editing", value: "cancel" },
              { label: "Discard unsaved changes", value: "discard" },
            ],
          );
          if (choice !== "discard")
            throw Error(
              "Your note draft is preserved. Retry saving or copy the text.",
            );
          clearTimeout(pending.current);
          draft.current = { ...saved.current };
          setTitle(saved.current.title);
          setBody(saved.current.body);
          sessionStorage.removeItem(key);
        }
      }),
    [],
  );

  return (
    <div
      className="note-editor"
      onCompositionStart={() => {
        composing.current = true;
        clearTimeout(pending.current);
      }}
      onCompositionEnd={() => {
        composing.current = false;
        pending.current = setTimeout(() => void save(), 500);
      }}
    >
      <input
        aria-label="Note title"
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void save()}
      />
      <textarea
        aria-label="Note body"
        placeholder="Let the thought land here…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => void save()}
      />
      <div className="row">
        <span role="status" className="muted">
          {status}
        </span>
        <button className="quiet" onClick={() => void save()}>
          Retry save
        </button>
        <button
          className="quiet"
          onClick={() =>
            void send("note.add", { title, body }).then(() =>
              setStatus("Saved as a separate copy"),
            )
          }
        >
          Save as copy
        </button>
        <button
          className="quiet"
          onClick={() =>
            void navigator.clipboard
              .writeText(`${title}\n\n${body}`)
              .then(() => setStatus("Draft copied"))
              .catch(() =>
                setStatus("Could not copy. Select and copy the text manually."),
              )
          }
        >
          Copy text
        </button>
        <button className="quiet" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
function Preferences({ snapshot, send }: { snapshot: Snapshot; send: Send }) {
  const s = snapshot.state.settings;
  const patch = (value: Partial<Settings>) =>
    void send("settings", { patch: value }).catch(() => {});
  return (
    <section>
      <h2>Make it yours.</h2>
      <p className="muted">
        Version {buildInfo.version} · Build {buildInfo.id} · Assets v
        {buildInfo.manifestVersion}
      </p>
      <p className="muted">Little details, just how you like them.</p>
      <button
        className="quiet"
        onClick={async () => {
          if (window.charme) {
            await action("reset-all");
            return;
          }
          if (
            (await ask(
              "Reset all data?",
              "Permanently delete all Charme data and managed backups? Export first to keep a copy.",
              [
                { label: "Keep data", value: "cancel" },
                { label: "Delete all data", value: "delete" },
              ],
            )) !== "delete"
          )
            return;
          try {
            await resetAll();
          } catch (error) {
            await ask("Reset failed", (error as Error).message, [
              { label: "Close", value: "cancel" },
            ]);
          }
        }}
      >
        Reset all data…
      </button>
      <div className="settings">
        <label>
          Daily water target <span>Liters · your personal target</span>
          <SyncedInput
            type="number"
            min="0.05"
            max="10"
            step="0.05"
            value={String(s.goalMl / 1000)}
            commit={(value, previous) =>
              send("settings", {
                patch: { goalMl: Math.round(Number(value) * 1000) },
                expected: { goalMl: Math.round(Number(previous) * 1000) },
              })
            }
          />
        </label>
        <label>
          Quick drink
          <select
            value={s.quickMl}
            onChange={(e) =>
              patch({ quickMl: Number(e.target.value) as 350 | 1000 })
            }
          >
            <option value="350">Glass · 350 mL</option>
            <option value="1000">Bottle · 1 L</option>
          </select>
        </label>
        <label>
          Reminder interval <span>Active minutes</span>
          <SyncedInput
            type="number"
            min="1"
            max="240"
            value={String(s.reminderMinutes)}
            commit={(value, previous) =>
              send("settings", {
                patch: { reminderMinutes: Number(value) },
                expected: { reminderMinutes: Number(previous) },
              })
            }
          />
        </label>
        <label>
          Your name
          <SyncedInput
            value={s.name}
            placeholder="A charm with your name"
            commit={(value, previous) =>
              send("settings", {
                patch: { name: value },
                expected: { name: previous },
              })
            }
          />
        </label>
        <label>
          Name finish
          <select
            value={s.nameStyle}
            onChange={(e) =>
              patch({ nameStyle: e.target.value as Settings["nameStyle"] })
            }
          >
            <option value="metal">Polished metal</option>
            <option value="neon">Neon glass</option>
          </select>
        </label>
        <label>
          Neon color
          <input
            type="color"
            value={s.neonColor}
            onChange={(e) => patch({ neonColor: e.target.value })}
          />
        </label>
        <button onClick={() => void action("charms")}>
          Manage the five optional charm slots
        </button>
        <label>
          Widget size
          <select
            value={s.scale}
            onChange={(e) =>
              patch({ scale: e.target.value as Settings["scale"] })
            }
          >
            <option>small</option>
            <option>medium</option>
            <option>large</option>
          </select>
        </label>
        {(
          [
            "reminders",
            "alwaysOnTop",
            "reducedMotion",
            "launchAtLogin",
            "notifications",
            "sound",
          ] as const
        ).map((k) => (
          <label className="toggle" key={k}>
            <span>
              {
                {
                  reminders: "Magical water reminders",
                  alwaysOnTop: "Keep above other windows",
                  reducedMotion: "Reduce motion",
                  launchAtLogin: "Open at login",
                  notifications: "System notifications",
                  sound: "Timer sound",
                }[k]
              }
            </span>
            <input
              type="checkbox"
              checked={s[k]}
              onChange={(e) => patch({ [k]: e.target.checked })}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  view === "studio-proof" ? (
    <Suspense fallback="Loading studio…">
      <StudioProof />
    </Suspense>
  ) : view === "import-preview" ? (
    <Suspense fallback="Loading import preview…">
      <ImportPreview />
    </Suspense>
  ) : view === "scene-proof" ? (
    <Suspense fallback="Loading scene…">
      <SceneProof />
      <AccessibilityAudit />
    </Suspense>
  ) : view === "asset-proof" ? (
    <Suspense fallback="Loading asset proof…">
      <AssetProof />
    </Suspense>
  ) : (
    <>
      <DialogHost />
      <App />
      {new URLSearchParams(location.search).has("audit") && (
        <AccessibilityAudit />
      )}
    </>
  ),
);
