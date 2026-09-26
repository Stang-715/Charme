import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  defaultAppearance,
  validateLayoutEnvelope,
} from "../shared/appearance";
import {
  slotIds,
  type CharmLibrary,
  type Slot,
  type SlotId,
  emptySlot,
  rotatedAttachment,
  validateLibrary,
} from "../shared/library";
import { charmById, decorations } from "../shared/charms";
import type { Snapshot } from "../shared/model";
import type { Send } from "./SceneWidget";
import { importAsset, initialize, ApiError, validateAsset } from "./api";
import { registerWriter } from "./flush";
import { ask } from "./Dialog";
import { DraftNumber } from "./DraftNumber";
import { ModelPreview } from "./ModelPreview";
const SceneWidget = lazy(() =>
  import("./SceneWidget").then((m) => ({ default: m.SceneWidget })),
);
const label = (id: SlotId) => String.fromCharCode(65 + slotIds.indexOf(id));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function CharmManager({
  snapshot,
  send,
}: {
  snapshot: Snapshot;
  send: Send;
}) {
  const saved = snapshot.state.settings.charms!,
    savedLayout = snapshot.state.settings.appearance ?? defaultAppearance();
  const [draft, setDraft] = useState(() => structuredClone(saved));
  const [layout, setLayout] = useState(() => structuredClone(savedLayout));
  const [selected, setSelected] = useState<SlotId>("companion");
  const [asset, setAsset] = useState(saved.slots.companion.asset ?? "duck");
  const [category, setCategory] = useState("all"),
    [section, setSection] = useState("collection"),
    [search, setSearch] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  const [file, setFile] = useState<File>(),
    [candidate, setCandidate] = useState<Slot>(() => emptySlot(asset));
  const [validating, setValidating] = useState(false);
  const [decoded, setDecoded] = useState(false),
    [multiple, setMultiple] = useState(false),
    [chosen, setChosen] = useState<string[]>([]);
  const [, refreshReadiness] = useState(0);
  const [conflict, setConflict] = useState(false),
    [reviewed, setReviewed] = useState<Snapshot>();
  const validationJob = useRef(0);
  const autoAttachment = useRef(false);
  const guard = useRef(false),
    baseline = useRef({
      library: structuredClone(saved),
      layout: structuredClone(savedLayout),
    });
  const ready = useRef(new Map<string, Slot>()),
    pending = useRef<{ id: string; data: Record<string, unknown> } | undefined>(
      undefined,
    );
  const dirty =
    !same(draft.slots, baseline.current.library.slots) ||
    !same(layout, baseline.current.layout);
  const slot = draft.slots[selected],
    empty = slotIds.filter((id) => !draft.slots[id].asset);
  const latest = useRef({
    dirty,
    busy,
    save: async (): Promise<void> => {},
    discard: () => {},
  });
  const name = (id: string | null) =>
    id
      ? (charmById(id)?.name ??
        draft.assets.find((a) => a.id === id)?.name ??
        "Unavailable charm")
      : "Empty";
  let issue = "";
  try {
    validateLibrary(draft);
    validateLayoutEnvelope(layout, {
      ...snapshot.state.settings,
      charms: draft,
    });
  } catch (e) {
    issue = (e as Error).message;
  }
  const changedUnready = slotIds.some(
    (id) =>
      draft.slots[id].asset &&
      !same(draft.slots[id], baseline.current.library.slots[id]) &&
      !ready.current.has(JSON.stringify(draft.slots[id])),
  );
  function discard() {
    setDraft(structuredClone(saved));
    setLayout(structuredClone(savedLayout));
    baseline.current = {
      library: structuredClone(saved),
      layout: structuredClone(savedLayout),
    };
    validationJob.current++;
    setValidating(false);
    pending.current = undefined;
    setConflict(false);
    setReviewed(undefined);
    setFile(undefined);
    setMessage("Saved arrangement restored.");
  }
  async function save() {
    if (guard.current)
      throw Error("An operation is still saving. Please wait.");
    if (issue || changedUnready)
      throw Error(issue || "Preview each changed position before applying.");
    guard.current = true;
    setBusy(true);
    setMessage("Saving arrangement…");
    const transaction = pending.current ?? {
      id: crypto.randomUUID(),
      data: {
        revision: draft.revision,
        library: structuredClone(draft),
        appearance: structuredClone(layout),
        appearanceRevision: layout.revision,
      },
    };
    pending.current = transaction;
    try {
      const result = await send(
        "charms.save",
        transaction.data,
        transaction.id,
      );
      const library = result.state.settings.charms!,
        appearance = result.state.settings.appearance!;
      baseline.current = {
        library: structuredClone(library),
        layout: structuredClone(appearance),
      };
      setDraft(structuredClone(library));
      setLayout(structuredClone(appearance));
      pending.current = undefined;
      setConflict(false);
      setMessage("Arrangement saved.");
    } catch (e) {
      // The command may have committed even if its acknowledgment was lost.
      try {
        const fresh = await initialize();
        if (fresh.state.processed.includes(transaction.id)) {
          const library = fresh.state.settings.charms!,
            appearance = fresh.state.settings.appearance!;
          baseline.current = {
            library: structuredClone(library),
            layout: structuredClone(appearance),
          };
          setDraft(structuredClone(library));
          setLayout(structuredClone(appearance));
          pending.current = undefined;
          setMessage("Arrangement saved; connection recovered.");
          return;
        }
        if (
          fresh.state.settings.charms!.revision !== transaction.data.revision ||
          fresh.state.settings.appearance!.revision !==
            transaction.data.appearanceRevision
        ) {
          setConflict(true);
          pending.current = undefined;
        }
      } catch {
        /* Keep the original command for an idempotent retry. */
      }
      if (e instanceof ApiError || window.charme) pending.current = undefined;
      setMessage((e as Error).message);
      throw e;
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  latest.current = { dirty, busy, save, discard };
  useEffect(
    () =>
      registerWriter(async () => {
        if (guard.current) throw Error("Wait for the current save to finish.");
        if (!latest.current.dirty) return;
        const choice = await ask(
          "Unsaved arrangement",
          "Save your arrangement before leaving, or discard these placement changes. Imported library assets are kept.",
          [
            { label: "Keep editing", value: "cancel" },
            { label: "Discard changes", value: "discard" },
            { label: "Save changes", value: "save", primary: true },
          ],
        );
        if (choice === "save") await latest.current.save();
        else if (choice === "discard") latest.current.discard();
        else throw Error("Your arrangement draft is still open.");
      }),
    [],
  );
  useEffect(() => {
    if (!latest.current.dirty && !guard.current) {
      baseline.current = {
        library: structuredClone(saved),
        layout: structuredClone(savedLayout),
      };
      setDraft(structuredClone(saved));
      setLayout(structuredClone(savedLayout));
    } else if (
      !same(saved.slots, baseline.current.library.slots) ||
      !same(savedLayout, baseline.current.layout)
    )
      setConflict(true);
    else {
      // Library imports may change its revision without changing any position.
      setDraft((d) => ({
        ...d,
        assets: saved.assets,
        revision: saved.revision,
      }));
      baseline.current.library = structuredClone(saved);
    }
  }, [saved.revision, savedLayout.revision]);
  useEffect(() => {
    if (!issue && !changedUnready) {
      window.charme?.previewLibrary(draft);
      window.charme?.preview(layout);
    } else {
      window.charme?.previewLibrary(null);
      window.charme?.preview(null);
    }
    return () => {
      window.charme?.previewLibrary(null);
      window.charme?.preview(null);
    };
  }, [draft, layout, issue, changedUnready]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty || guard.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  function browse(id: string) {
    if (guard.current) return;
    validationJob.current++;
    setValidating(false);
    if (asset === id && !editing && !file) return;
    setFile(undefined);
    setAsset(id);
    setCandidate(emptySlot(id));
    setEditing(false);
    setDecoded(false);
  }
  function select(id: SlotId) {
    if (guard.current) return;
    validationJob.current++;
    setValidating(false);
    setSelected(id);
    setFile(undefined);
    setEditing(!!draft.slots[id].asset);
    if (draft.slots[id].asset) {
      setAsset(draft.slots[id].asset!);
      setCandidate(draft.slots[id]);
    }
  }
  function update(patch: Partial<Slot>) {
    if (guard.current || pending.current) return;
    const previous = draft.slots[selected];
    const next = { ...previous, ...patch };
    if (
      patch.rotation &&
      !patch.attachment &&
      patch.rotation.every(Number.isFinite)
    )
      next.attachment = rotatedAttachment(
        previous.attachment,
        previous.rotation,
        patch.rotation,
      );
    setDraft((d) => ({ ...d, slots: { ...d.slots, [selected]: next } }));
  }
  function stage(id: string, target = selected) {
    if (guard.current || pending.current || draft.slots[target].asset === id)
      return;
    const calibrated = ready.current.get(id);
    if (!calibrated) {
      setMessage("Preview this model before adding it.");
      return;
    }
    const next = structuredClone(calibrated);
    ready.current.set(JSON.stringify(next), next);
    setDraft((d) => ({ ...d, slots: { ...d.slots, [target]: next } }));
    const defaults = defaultAppearance();
    setLayout((l) => ({
      ...l,
      scales: { ...l.scales, [target]: defaults.scales[target] },
      links: { ...l.links, [target]: defaults.links[target] },
    }));
    setMessage(
      `${name(id)} staged in position ${label(target)}. Apply arrangement to save.`,
    );
  }
  async function importFile() {
    if (!file || !decoded || guard.current) return;
    guard.current = true;
    setBusy(true);
    setMessage("Importing to library…");
    try {
      const record = await importAsset(file);
      const fresh = await initialize();
      const library = fresh.state.settings.charms!;
      setDraft((d) => ({
        ...d,
        assets: library.assets,
        revision: library.revision,
      }));
      baseline.current.library = {
        ...baseline.current.library,
        assets: library.assets,
        revision: library.revision,
      };
      const calibrated = { ...candidate, asset: record.id };
      ready.current.set(record.id, calibrated);
      ready.current.set(JSON.stringify(calibrated), calibrated);
      setFile(undefined);
      setAsset(record.id);
      setCandidate(calibrated);
      setSection("imports");
      setMessage(
        "Imported to library. Add to a position, or keep it here for later.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const displaySlot = editing ? slot : candidate;
  const finiteDraft =
    Object.values(layout.scales).every(Number.isFinite) &&
    Object.values(layout.links).every(Number.isFinite) &&
    slotIds.every((id) =>
      [...draft.slots[id].rotation, ...draft.slots[id].attachment].every(
        Number.isFinite,
      ),
    );
  const items =
    section === "collection"
      ? decorations.map((d) => ({
          id: d.id,
          name: d.name,
          thumbnail: d.thumbnail,
          category: d.category || "Classics",
        }))
      : draft.assets.map((a) => ({
          id: a.id,
          name: a.name,
          thumbnail: undefined,
          category: "Imported",
        }));
  const filtered = items.filter(
    (a) =>
      (category === "all" || a.category === category) &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="charm-manager studio" aria-labelledby="charms-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">COLLECTOR STUDIO</span>
          <h2 id="charms-title">Make it yours.</h2>
          <p>Choose the little things you carry.</p>
        </div>
        <span className="capacity">{7 - empty.length} / 7 charms</span>
      </div>
      <fieldset disabled={busy || !!pending.current} className="studio-fields">
        <div className="slot-cards" aria-label="Your arrangement">
          <div className="slot-card fixed">
            Bottle<small>Fixed · hydration</small>
          </div>
          <div className="slot-card fixed">
            Notebook<small>Fixed · your hub</small>
          </div>
          {slotIds.map((id) => (
            <button
              key={id}
              aria-pressed={selected === id}
              onClick={() => select(id)}
            >
              <small>Position {label(id)}</small>
              <strong>{name(draft.slots[id].asset)}</strong>
            </button>
          ))}
        </div>
        <div className="studio-workspace">
          <div className="collection-pane">
            <div className="segmented" role="group" aria-label="Library source">
              {["collection", "imports"].map((s) => (
                <button
                  key={s}
                  aria-pressed={section === s}
                  onClick={() => {
                    setSection(s);
                    setCategory("all");
                  }}
                >
                  {s === "collection" ? "Collection" : "My imports"}
                </button>
              ))}
            </div>
            <div className="library-filters">
              <label>
                Search charms
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a charm"
                />
              </label>
              <label>
                Category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">All categories</option>
                  {[...new Set(items.map((a) => a.category))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              disabled={!empty.length && !multiple}
              aria-pressed={multiple}
              onClick={() => {
                setMultiple(!multiple);
                setChosen([]);
              }}
            >
              {" "}
              {multiple ? "Finish selection" : "Select multiple"}
            </button>
            {!empty.length && (
              <p>
                All five optional positions are occupied. Select a position to
                replace its charm.
              </p>
            )}
            <div className="charm-gallery">
              {filtered.map((a) => (
                <article
                  className={
                    asset === a.id ? "charm-card active" : "charm-card"
                  }
                  key={a.id}
                >
                  <button
                    className="charm-card-preview"
                    aria-pressed={asset === a.id}
                    onClick={() => browse(a.id)}
                  >
                    {a.thumbnail ? (
                      <img src={`./${a.thumbnail}`} alt="" />
                    ) : (
                      <span className="thumbnail-placeholder">3D</span>
                    )}
                    <strong>{a.name}</strong>
                    <small>
                      {slotIds
                        .filter((id) => draft.slots[id].asset === a.id)
                        .map((id) => label(id))
                        .join(", ") || a.category}
                    </small>
                  </button>
                  {multiple && (
                    <label className="batch-check">
                      <input
                        type="checkbox"
                        checked={chosen.includes(a.id)}
                        disabled={
                          !chosen.includes(a.id) &&
                          chosen.length >= empty.length
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setChosen((c) => [...c, a.id]);
                            browse(a.id);
                          } else
                            setChosen((c) => c.filter((id) => id !== a.id));
                        }}
                      />
                      Select {a.name}
                    </label>
                  )}
                </article>
              ))}
            </div>
            {!filtered.length && (
              <p className="empty-state">
                {search
                  ? "No matching charms. Try another search."
                  : "Your imported charms will appear here."}
              </p>
            )}
            {multiple && (
              <button
                disabled={
                  !chosen.length ||
                  chosen.length > empty.length ||
                  chosen.some((id) => !ready.current.has(id))
                }
                onClick={async () => {
                  const targets = empty.slice(0, chosen.length);
                  const response = await ask(
                    "Review new charms",
                    chosen
                      .map(
                        (id, i) =>
                          `${name(id)} → position ${label(targets[i])}`,
                      )
                      .join("\n"),
                    [
                      { label: "Keep selecting", value: "cancel" },
                      {
                        label: "Stage arrangement",
                        value: "stage",
                        primary: true,
                      },
                    ],
                  );
                  if (response === "stage") {
                    chosen.forEach((id, i) => stage(id, targets[i]));
                    setChosen([]);
                    setMultiple(false);
                  }
                }}
              >
                Add selected to arrangement
              </button>
            )}
            <label className="upload-control">
              Upload your own GLB
              <input
                type="file"
                accept=".glb"
                disabled={validating}
                onChange={async (e) => {
                  const next = e.target.files?.[0];
                  e.target.value = "";
                  if (!next) return;
                  if (next.size > 20_000_000) {
                    setMessage("GLB must be no larger than 20 MB.");
                    return;
                  }
                  if (validating) return;
                  const job = ++validationJob.current;
                  setValidating(true);
                  setMessage("Validating GLB…");
                  try {
                    await validateAsset(next);
                    if (validationJob.current !== job) return;
                    autoAttachment.current = true;
                    setFile(next);
                    setCandidate(emptySlot("local-preview"));
                    setAsset("local-preview");
                    setEditing(false);
                    setDecoded(false);
                    setMessage(
                      "Validated. Inspect the preview before importing.",
                    );
                  } catch (e) {
                    if (validationJob.current === job)
                      setMessage((e as Error).message);
                  } finally {
                    if (validationJob.current === job) setValidating(false);
                  }
                }}
              />
            </label>
            {validating && (
              <button
                onClick={() => {
                  validationJob.current++;
                  setValidating(false);
                  setMessage("Import validation canceled.");
                }}
              >
                Cancel validation
              </button>
            )}
            <p className="muted">
              Self-contained GLB · up to 20 MB. Importing does not replace a
              charm.
            </p>
          </div>
          <div className="detail-pane">
            <h3>{file ? file.name : name(editing ? slot.asset : asset)}</h3>
            {(editing ? slot.asset : asset) && (
              <ModelPreview
                asset={editing ? slot.asset! : asset}
                file={file}
                slot={displaySlot}
                editing={editing || !!file}
                onReady={(valid, recommended) => {
                  setDecoded(valid);
                  refreshReadiness((n) => n + 1);
                  if (!recommended) return;
                  if (valid) autoAttachment.current = false;
                  const calibrated = {
                    ...displaySlot,
                    attachment: valid ? displaySlot.attachment : recommended,
                  };
                  if (!editing) {
                    if (valid || !file) ready.current.set(asset, calibrated);
                    if (
                      !valid &&
                      (!file || autoAttachment.current) &&
                      !same(candidate.attachment, recommended)
                    ) {
                      autoAttachment.current = false;
                      setCandidate(calibrated);
                    }
                  } else if (valid)
                    ready.current.set(JSON.stringify(displaySlot), displaySlot);
                  if (!guard.current)
                    setMessage(
                      valid || (!editing && !file)
                        ? ""
                        : "The tether point must touch the model. Adjust it before applying.",
                    );
                }}
                onAttachment={(point) =>
                  editing
                    ? update({ attachment: point })
                    : setCandidate((c) => ({ ...c, attachment: point }))
                }
              />
            )}
            {file ? (
              <div className="row">
                <button disabled={!decoded} onClick={() => void importFile()}>
                  Import to library
                </button>
                <button
                  onClick={() => {
                    setFile(undefined);
                    browse("duck");
                  }}
                >
                  Cancel import
                </button>
              </div>
            ) : !editing ? (
              <button
                className="primary"
                disabled={!decoded || slot.asset === asset}
                onClick={() => stage(asset)}
              >
                {slot.asset ? "Replace in" : "Add to"} position{" "}
                {label(selected)}
              </button>
            ) : (
              <button
                onClick={() => {
                  setEditing(false);
                  setCandidate(emptySlot(asset));
                }}
              >
                Browse another charm
              </button>
            )}
            {slot.asset && (
              <div className="row">
                <button
                  aria-expanded={editing}
                  onClick={() => {
                    setFile(undefined);
                    setAsset(slot.asset!);
                    setEditing(true);
                  }}
                >
                  Edit placement
                </button>
                <button
                  onClick={() => {
                    update({ asset: null });
                    setEditing(false);
                    setMessage(
                      "Removed from draft. Apply arrangement to save.",
                    );
                  }}
                >
                  Remove from position {label(selected)}
                </button>
              </div>
            )}
            {file && (
              <fieldset>
                <legend>Import rest orientation</legend>
                {["X", "Y", "Z"].map((axis, i) => (
                  <label key={axis}>
                    {axis} rotation
                    <DraftNumber
                      label={`${axis} import rotation`}
                      min={-360}
                      max={360}
                      value={candidate.rotation[i]}
                      onValue={(n) => {
                        const rotation = [
                          ...candidate.rotation,
                        ] as Slot["rotation"];
                        rotation[i] = n;
                        setCandidate((c) => ({
                          ...c,
                          rotation,
                          attachment: rotation.every(Number.isFinite)
                            ? rotatedAttachment(
                                c.attachment,
                                c.rotation,
                                rotation,
                              )
                            : c.attachment,
                        }));
                      }}
                    />
                  </label>
                ))}
                <legend>Import attachment coordinates</legend>
                {["X", "Y", "Z"].map((axis, i) => (
                  <label key={axis}>
                    {axis} attachment
                    <DraftNumber
                      label={`${axis} import attachment`}
                      min={-0.75}
                      max={0.75}
                      step={0.01}
                      value={candidate.attachment[i]}
                      onValue={(n) => {
                        const attachment = [
                          ...candidate.attachment,
                        ] as Slot["attachment"];
                        attachment[i] = n;
                        setCandidate((c) => ({ ...c, attachment }));
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            )}
            {editing && slot.asset && (
              <div className="placement-editor">
                {slot.asset === "tag" && (
                  <fieldset>
                    <legend>Name tag</legend>
                    <label>
                      Name · up to 24 characters
                      <input
                        value={slot.name ?? snapshot.state.settings.name}
                        onChange={(e) => update({ name: e.target.value })}
                      />
                    </label>
                    <label>
                      Lettering
                      <select
                        value={
                          slot.nameStyle ?? snapshot.state.settings.nameStyle
                        }
                        onChange={(e) =>
                          update({
                            nameStyle: e.target.value as "neon" | "metal",
                          })
                        }
                      >
                        <option value="metal">Metal</option>
                        <option value="neon">Neon</option>
                      </select>
                    </label>
                    <label>
                      Neon color
                      <input
                        type="color"
                        value={
                          slot.nameColor ?? snapshot.state.settings.neonColor
                        }
                        onChange={(e) => update({ nameColor: e.target.value })}
                      />
                    </label>
                  </fieldset>
                )}
                <fieldset>
                  <legend>Rest orientation</legend>
                  {["X", "Y", "Z"].map((axis, i) => (
                    <label key={axis}>
                      {axis} rotation (degrees)
                      <DraftNumber
                        label={`${axis} rotation`}
                        min={-360}
                        max={360}
                        value={slot.rotation[i]}
                        onValue={(n) => {
                          const rotation = [
                            ...slot.rotation,
                          ] as Slot["rotation"];
                          rotation[i] = n;
                          update({ rotation });
                        }}
                      />
                      <button
                        onClick={() => {
                          const rotation = [
                            ...slot.rotation,
                          ] as Slot["rotation"];
                          rotation[i] =
                            ((Number.isFinite(rotation[i]) ? rotation[i] : 0) +
                              90) %
                            360;
                          update({ rotation });
                        }}
                      >
                        Turn {axis} 90°
                      </button>
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>
                    Tether point · click the model or enter coordinates
                  </legend>
                  {["X", "Y", "Z"].map((axis, i) => (
                    <label key={axis}>
                      {axis} attachment
                      <DraftNumber
                        label={`${axis} attachment`}
                        min={-0.75}
                        max={0.75}
                        step={0.01}
                        value={slot.attachment[i]}
                        onValue={(n) => {
                          const attachment = [
                            ...slot.attachment,
                          ] as Slot["attachment"];
                          attachment[i] = n;
                          update({ attachment });
                        }}
                      />
                    </label>
                  ))}
                </fieldset>
                <label>
                  Size (%)
                  <DraftNumber
                    label="Size (%)"
                    min={50}
                    max={150}
                    value={layout.scales[selected] * 100}
                    onValue={(n) =>
                      setLayout((l) => ({
                        ...l,
                        scales: { ...l.scales, [selected]: n / 100 },
                      }))
                    }
                  />
                </label>
                <label>
                  Chain links
                  <DraftNumber
                    label="Chain links"
                    min={3}
                    max={20}
                    value={layout.links[selected]}
                    onValue={(n) =>
                      setLayout((l) => ({
                        ...l,
                        links: { ...l.links, [selected]: n },
                      }))
                    }
                  />
                </label>
                <button
                  onClick={() => {
                    const defaults = defaultAppearance();
                    update({
                      rotation: [0, 0, 0],
                      attachment: ready.current.get(slot.asset!)
                        ?.attachment ?? [0, 0.5, 0],
                    });
                    setLayout((l) => ({
                      ...l,
                      scales: {
                        ...l.scales,
                        [selected]: defaults.scales[selected],
                      },
                      links: {
                        ...l.links,
                        [selected]: defaults.links[selected],
                      },
                    }));
                  }}
                >
                  Reset selected placement
                </button>
              </div>
            )}
          </div>
        </div>
        {!window.charme && (
          <p className="muted">
            Browser edits use the arrangement preview below. The native editor
            also previews valid changes on the desktop widget.
          </p>
        )}
        <details className="layout-live-preview">
          <summary>
            Arrangement preview · {dirty ? "unsaved changes" : "saved"}
          </summary>
          <div className="preview-stage">
            {finiteDraft ? (
              <Suspense fallback={<p>Loading arrangement…</p>}>
                <SceneWidget
                  snapshot={{
                    ...snapshot,
                    undoWater: null,
                    state: {
                      ...snapshot.state,
                      settings: {
                        ...snapshot.state.settings,
                        scale: "medium",
                        charms: draft,
                      },
                    },
                  }}
                  send={send}
                  appearance={
                    Object.values(layout.scales).every(Number.isFinite) &&
                    Object.values(layout.links).every(Number.isFinite)
                      ? layout
                      : savedLayout
                  }
                  editing
                  onSelect={(id) => {
                    if (slotIds.includes(id as SlotId)) select(id as SlotId);
                  }}
                />
              </Suspense>
            ) : (
              <p>
                Correct the highlighted numeric values to resume the arrangement
                preview. Your draft is preserved.
              </p>
            )}
          </div>
          <p>
            {issue
              ? `Draft cannot be applied: ${issue}`
              : "Preview only. Apply arrangement to save."}
          </p>
        </details>
        <button
          onClick={async () => {
            if (
              (await ask(
                "Reset entire arrangement?",
                "Return to Bottle, Notebook and Duck with default sizes and chains. Per-position name text is reset. Imported assets, notes and history are kept.",
                [
                  { label: "Keep arrangement", value: "cancel" },
                  { label: "Reset draft", value: "reset" },
                ],
              )) === "reset"
            ) {
              const slots = Object.fromEntries(
                slotIds.map((id) => [
                  id,
                  emptySlot(id === "companion" ? "duck" : null),
                ]),
              ) as CharmLibrary["slots"];
              setDraft((d) => ({ ...d, slots }));
              setLayout({ ...defaultAppearance(), revision: layout.revision });
              setSelected("companion");
              setAsset("duck");
              setCandidate(emptySlot("duck"));
              setEditing(true);
            }
          }}
        >
          Reset entire arrangement
        </button>
        {section === "imports" && (
          <section>
            <h3>Library storage</h3>
            <p>
              {(
                draft.assets.reduce((sum, a) => sum + a.bytes, 0) / 1e6
              ).toFixed(1)}{" "}
              / 250 MB
            </p>
            {draft.assets.map((a) => (
              <div className="library-item" key={a.id}>
                <span>{a.name}</span>
                <button
                  disabled={
                    dirty ||
                    slotIds.some((id) => saved.slots[id].asset === a.id)
                  }
                  onClick={async () => {
                    if (
                      (await ask(
                        "Delete library asset?",
                        `${a.name} will leave My imports. Recovery backups retain their referenced bytes.`,
                        [
                          { label: "Keep asset", value: "cancel" },
                          { label: "Delete asset", value: "delete" },
                        ],
                      )) !== "delete"
                    )
                      return;
                    if (guard.current) return;
                    guard.current = true;
                    setBusy(true);
                    try {
                      await send("asset.remove", {
                        assetId: a.id,
                        revision: saved.revision,
                      });
                    } catch (e) {
                      setMessage((e as Error).message);
                    } finally {
                      guard.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  Delete from library
                </button>
              </div>
            ))}
          </section>
        )}
      </fieldset>
      {conflict && (
        <aside className="error">
          <p>
            Another client changed the arrangement. Your draft is preserved.
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                setReviewed(await initialize());
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Review latest arrangement
          </button>
          {reviewed && (
            <>
              <p>
                {slotIds
                  .filter(
                    (id) =>
                      !same(
                        reviewed.state.settings.charms!.slots[id],
                        baseline.current.library.slots[id],
                      ),
                  )
                  .map(
                    (id) =>
                      `Position ${label(id)}: ${name(reviewed.state.settings.charms!.slots[id].asset)}`,
                  )
                  .join(" · ") || "Placement settings changed."}
              </p>
              <button
                onClick={async () => {
                  if (
                    (await ask(
                      "Reapply your draft?",
                      "Your draft will replace the latest arrangement when you next click Apply. Review every affected position first.",
                      [
                        { label: "Keep reviewing", value: "cancel" },
                        { label: "Reapply draft", value: "reapply" },
                      ],
                    )) === "reapply"
                  ) {
                    setDraft((d) => ({
                      ...d,
                      revision: reviewed.state.settings.charms!.revision,
                      assets: reviewed.state.settings.charms!.assets,
                    }));
                    setLayout((l) => ({
                      ...l,
                      revision: reviewed.state.settings.appearance!.revision,
                    }));
                    setConflict(false);
                    setReviewed(undefined);
                    pending.current = undefined;
                  }
                }}
              >
                Reapply draft against latest
              </button>
            </>
          )}
        </aside>
      )}
      {issue && (
        <p role="alert" className="error">
          {issue}
        </p>
      )}
      {changedUnready && (
        <p>
          Open Edit placement for each changed position to validate its
          attachment.
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="studio-savebar">
        <span>
          {busy
            ? "Saving…"
            : dirty
              ? "Unsaved arrangement"
              : "Arrangement saved"}
        </span>
        <button
          disabled={busy || !!pending.current}
          onClick={async () => {
            if (
              !dirty ||
              (await ask(
                "Discard arrangement changes?",
                "Restore the latest saved arrangement. Imported assets remain in your library.",
                [
                  { label: "Keep editing", value: "cancel" },
                  { label: "Discard changes", value: "discard" },
                ],
              )) === "discard"
            )
              discard();
          }}
        >
          Cancel changes
        </button>
        <button
          className="primary"
          disabled={busy || !!issue || changedUnready || !dirty || conflict}
          onClick={() => void save().catch(() => {})}
        >
          {pending.current ? "Retry arrangement save" : "Apply arrangement"}
        </button>
      </div>
    </section>
  );
}
