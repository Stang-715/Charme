import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Service } from "../src/main/service";
import { Storage } from "../src/main/storage";
import { inspectGlb } from "../src/main/assets";
import { parseArchive } from "../src/main/archive";
import {
  migrateLibrary,
  validateLibrary,
  emptySlot,
} from "../src/shared/library";
import { initialState } from "../src/shared/model";
import { widgetSizes } from "../src/shared/layout";
async function setup(t: any) {
  const dir = await mkdtemp("/private/tmp/charme-compact-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const s = new Service(new Storage(dir));
  await s.initialize();
  return s;
}
const duck = () => readFile("public/models/duck.glb");
test("compact dimensions and five-slot migration retains names", () => {
  assert.deepEqual(widgetSizes.small, [180, 268]);
  assert.deepEqual(widgetSizes.large, [360, 535]);
  const l = migrateLibrary({
    decoration: "duck",
    extras: ["car", "duck"],
    name: "Kept",
  });
  validateLibrary(l);
  assert.equal(Object.values(l.slots).filter((x) => x.asset).length, 4);
  assert.equal(l.slots.extra2.asset, "tag");
  const one = migrateLibrary({
    decoration: "duck",
    extras: [null, null],
    name: "Tag",
  });
  assert.equal(one.slots.extra0.asset, "tag");
});
test("GLB accepts actual generated asset and rejects bad headers", async () => {
  const bytes = await duck();
  assert.ok(inspectGlb(bytes, "duck").triangles > 0);
  const wrong = Buffer.from(bytes);
  wrong.writeUInt32LE(1, 4);
  assert.throws(() => inspectGlb(wrong, "duck"), /header/);
  assert.throws(
    () => inspectGlb(bytes.subarray(0, bytes.length - 1), "duck"),
    /header/,
  );
});
test("invalid external-resource GLB is rejected before decoding", async () => {
  const b = await duck();
  const n = b.readUInt32LE(12),
    json = JSON.parse(b.subarray(20, 20 + n).toString());
  json.buffers[0].uri = "https://example.com/private";
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]);
  const header = Buffer.from(b.subarray(0, 20));
  header.writeUInt32LE(j.length, 12);
  const altered = Buffer.concat([header, j, b.subarray(20 + n)]);
  altered.writeUInt32LE(altered.length, 8);
  assert.throws(() => inspectGlb(altered, "bad"), /URIs/);
});
test("service shares latest water undo only after persistence and never revives on restart", async (t) => {
  const s = await setup(t);
  const id = crypto.randomUUID();
  await s.command({ id, type: "water.add", ml: 350 });
  assert.equal(s.snapshot().undoWater?.id, id);
  await s.command({ id, type: "water.add", ml: 350 });
  assert.equal(s.state.drinks.length, 1);
  await s.command({
    id: crypto.randomUUID(),
    type: "water.delete",
    itemId: id,
  });
  assert.equal(s.snapshot().undoWater, null);
  await s.command({ id: crypto.randomUUID(), type: "water.add", ml: 1000 });
  await s.close();
  const reopened = new Service(s.storage);
  await reopened.initialize();
  assert.equal(reopened.snapshot().undoWater, null);
});
test("failed water save does not advertise Undo", async (t) => {
  const s = await setup(t);
  s.storage.save = async () => {
    throw Error("disk full");
  };
  await assert.rejects(
    s.command({ id: crypto.randomUUID(), type: "water.add", ml: 350 }),
    /disk full/,
  );
  assert.equal(s.snapshot().undoWater, null);
  assert.equal(s.state.drinks.length, 0);
});
test("asset library import deduplicates, assignment revisions conflict, backup round trips", async (t) => {
  const s = await setup(t),
    bytes = await duck();
  const a = await s.importAsset(bytes, "Duck upload");
  await s.importAsset(bytes, "Again");
  assert.equal(s.state.settings.charms!.assets.length, 1);
  const l = structuredClone(s.state.settings.charms!);
  l.slots.extra0 = emptySlot(a.id);
  await s.command({
    id: crypto.randomUUID(),
    type: "charms.save",
    revision: l.revision,
    library: l,
  });
  await assert.rejects(
    s.command({
      id: crypto.randomUUID(),
      type: "charms.save",
      revision: l.revision,
      library: l,
    }),
    /another window/,
  );
  await assert.rejects(
    s.command({
      id: crypto.randomUUID(),
      type: "asset.remove",
      assetId: a.id,
      revision: s.state.settings.charms!.revision,
    }),
    /slots first/,
  );
  const archive = await s.exportBackup(),
    parsed = parseArchive(archive);
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0].record.id, a.id);
  const corrupted = Buffer.from(archive);
  corrupted[corrupted.length - 20] ^= 1;
  assert.throws(() => parseArchive(corrupted), /integrity|GLB/);
  await s.restoreBackup(archive);
  assert.equal(s.state.timer.intent, false);
  assert.equal(s.state.settings.charms!.slots.extra0.asset, a.id);
});
test("nested newer schemas never fall back to an older backup", async (t) => {
  const s = await setup(t);
  const raw = structuredClone(s.state) as any;
  raw.settings.charms.version = 7;
  await writeFile(s.storage.file("state.json"), JSON.stringify(raw));
  await assert.rejects(s.storage.load(), /Unsupported/);
  assert.equal(
    JSON.parse(await readFile(s.storage.file("state.json"), "utf8")).settings
      .charms.version,
    7,
  );
});
test("three active imported instances enforce combined triangle budget", async () => {
  const a = inspectGlb(await duck(), "duck");
  a.triangles = 150000;
  const l = initialState().settings.charms!;
  l.assets = [a];
  l.slots.companion = emptySlot(a.id);
  l.slots.extra0 = emptySlot(a.id);
  validateLibrary(l);
  l.slots.extra1 = emptySlot(a.id);
  assert.throws(() => validateLibrary(l), /combined scene/);
});
test("schema-one migration is backed up and committed as schema four", async (t) => {
  const s = await setup(t),
    legacy = initialState() as any;
  legacy.schema = 1;
  delete legacy.settings.charms;
  legacy.settings.name = "Remember";
  legacy.settings.extras = ["duck", "car"];
  await writeFile(s.storage.file("state.json"), JSON.stringify(legacy));
  const migrated = new Service(s.storage);
  await migrated.initialize();
  assert.equal(migrated.state.schema, 4);
  assert.equal(migrated.state.settings.charms!.slots.extra2.asset, "tag");
  const { readdir } = await import("node:fs/promises");
  assert.ok(
    (await readdir(s.storage.directory)).some((n) =>
      n.startsWith("pre-upgrade-"),
    ),
  );
});
test("failed asset registration removes new unreferenced bytes and leaves slots intact", async (t) => {
  const s = await setup(t);
  const record = inspectGlb(await duck(), "duck");
  s.storage.save = async () => {
    throw Error("disk full");
  };
  await assert.rejects(s.importAsset(await duck(), "duck"), /disk full/);
  assert.equal(s.state.settings.charms!.assets.length, 0);
  assert.equal(s.state.settings.charms!.slots.companion.asset, "duck");
  await assert.rejects(s.assets.read(record.id), /ENOENT/);
});
test("archive refuses duplicate entries, missing bytes, and extra bytes", async (t) => {
  const s = await setup(t);
  await s.importAsset(await duck(), "duck");
  const archive = await s.exportBackup();
  assert.throws(
    () => parseArchive(archive.subarray(0, archive.length - 1)),
    /entry/,
  );
  assert.throws(
    () => parseArchive(Buffer.concat([archive, Buffer.from([0])])),
    /trailing/,
  );
  const length = archive.readUInt32LE(8);
  const header = JSON.parse(archive.subarray(12, 12 + length).toString());
  header.entries.push(header.entries[0]);
  const metadata = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.from(archive.subarray(0, 12));
  prefix.writeUInt32LE(metadata.length, 8);
  assert.throws(
    () =>
      parseArchive(
        Buffer.concat([prefix, metadata, archive.subarray(12 + length)]),
      ),
    /entry/,
  );
});
test("charm assignment and size apply in one revision-checked operation", async (t) => {
  const s = await setup(t);
  const library = structuredClone(s.state.settings.charms!),
    appearance = structuredClone(s.state.settings.appearance!);
  library.slots.extra0 = emptySlot("duck");
  appearance.scales.extra0 = 0.9;
  const revision = s.state.revision;
  await s.command({
    id: crypto.randomUUID(),
    type: "charms.save",
    library,
    revision: library.revision,
    appearance,
    appearanceRevision: appearance.revision,
  });
  assert.equal(s.state.revision, revision + 1);
  assert.equal(s.state.settings.charms!.slots.extra0.asset, "duck");
  assert.equal(s.state.settings.appearance!.scales.extra0, 0.9);
  const stale = structuredClone(s.state.settings.charms!);
  stale.slots.extra1 = emptySlot("car");
  await assert.rejects(
    s.command({
      id: crypto.randomUUID(),
      type: "charms.save",
      library: stale,
      revision: stale.revision,
      appearance,
      appearanceRevision: appearance.revision,
    }),
    /Layout changed/,
  );
  assert.equal(s.state.settings.charms!.slots.extra1.asset, null);
});
test("orientation changes keep the same model attachment point", async () => {
  const { rotatedAttachment } = await import("../src/shared/library");
  const point: [number, number, number] = [0.2, 0.4, 0.1];
  const turned = rotatedAttachment(point, [0, 0, 0], [0, 90, 0]);
  assert.ok(Math.abs(turned[0] - 0.1) < 1e-10);
  assert.ok(Math.abs(turned[2] + 0.2) < 1e-10);
  const restored = rotatedAttachment(turned, [0, 90, 0], [0, 0, 0]);
  restored.forEach((n, i) => assert.ok(Math.abs(n - point[i]) < 1e-10));
});

test("schema-two three-slot layouts migrate without changing existing assignments or sizes", async (t) => {
  const service = await setup(t);
  const old = structuredClone(service.state) as any;
  old.schema = 2;
  old.settings.charms.version = 1;
  old.settings.appearance.version = 1;
  delete old.settings.charms.slots.extra2;
  delete old.settings.charms.slots.extra3;
  for (const key of ["extra2", "extra3"]) {
    delete old.settings.appearance.scales[key];
    delete old.settings.appearance.links[key];
  }
  old.settings.charms.slots.extra0 = emptySlot("car");
  old.settings.appearance.scales.extra0 = 0.75;
  await writeFile(service.storage.file("state.json"), JSON.stringify(old));
  const restored = new Service(service.storage);
  await restored.initialize();
  assert.equal(restored.state.schema, 4);
  assert.equal(restored.state.settings.charms!.slots.extra0.asset, "car");
  assert.equal(restored.state.settings.appearance!.scales.extra0, 0.75);
  assert.equal(restored.state.settings.charms!.slots.extra3.asset, null);
  const { readdir } = await import("node:fs/promises");
  assert.ok(
    (await readdir(service.storage.directory)).some((n) =>
      n.startsWith("pre-seven-charms-"),
    ),
  );
});
test("seven-charms layout accepts five optional instances and independently editable tags", async (t) => {
  const service = await setup(t);
  const library = structuredClone(service.state.settings.charms!);
  const { slotIds } = await import("../src/shared/library");
  for (const id of slotIds) library.slots[id] = emptySlot("duck");
  library.slots.extra2 = {
    ...emptySlot("tag"),
    name: "NOVA",
    nameStyle: "neon",
    nameColor: "#00ffaa",
  };
  library.slots.extra3 = {
    ...emptySlot("tag"),
    name: "MOON",
    nameStyle: "metal",
    nameColor: "#aaffee",
  };
  await service.command({
    id: crypto.randomUUID(),
    type: "charms.save",
    revision: library.revision,
    library,
  });
  assert.equal(
    Object.values(service.state.settings.charms!.slots).filter((s) => s.asset)
      .length,
    5,
  );
  const invalid = structuredClone(library);
  invalid.slots.extra3.name = "a".repeat(25);
  assert.throws(() => validateLibrary(invalid), /24 characters/);
});
