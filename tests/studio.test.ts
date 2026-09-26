import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { Service } from "../src/main/service";
import { Storage } from "../src/main/storage";
import { inspectGlb } from "../src/main/assets";
import { decorations, charmById } from "../src/shared/charms";
import { initialState } from "../src/shared/model";
import { emptySlot, validateLibrary, slotIds } from "../src/shared/library";
async function setup(t: any) {
  const dir = await mkdtemp("/private/tmp/charme-studio-test-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = new Service(new Storage(dir));
  await service.initialize();
  return service;
}
test("all six generated collection assets have bounded real GLBs and thumbnails", async () => {
  for (const id of [
    "blue-cat",
    "spiked-ball",
    "white-sports-car",
    "motorsport-coupe",
    "soda-blaster",
    "energy-canister",
  ]) {
    const def = charmById(id)!;
    assert.ok(decorations.includes(def));
    assert.equal(def.provider, "Magnific");
    assert.ok(def.preserveMaterials);
    const actual = inspectGlb(await readFile("public/" + def.model), def.name);
    assert.deepEqual(def.resources, {
      triangles: actual.triangles,
      primitives: actual.primitives,
      textureBytes: actual.textureBytes,
    });
    assert.ok(actual.textureBytes < 17 * 1024 * 1024);
    assert.ok((await readFile("public/" + def.thumbnail)).length > 0);
  }
});
test("five generated optional charms fit the resource budget; fixed artwork is rejected", () => {
  const l = initialState().settings.charms!;
  slotIds.forEach((id) => (l.slots[id] = emptySlot("spiked-ball")));
  assert.doesNotThrow(() => validateLibrary(l));
  l.slots.extra3.asset = "hoop";
  assert.throws(() => validateLibrary(l), /Functional/);
});
test("duplicate simultaneous Apply commits only one revision", async (t) => {
  const s = await setup(t);
  const library = structuredClone(s.state.settings.charms!);
  library.slots.companion.asset = "blue-cat";
  const appearance = structuredClone(s.state.settings.appearance!);
  const c = {
    id: crypto.randomUUID(),
    type: "charms.save",
    revision: library.revision,
    library,
    appearance,
    appearanceRevision: appearance.revision,
  };
  await Promise.all([s.command(c), s.command(c)]);
  assert.equal(s.state.settings.charms!.revision, library.revision + 1);
  assert.equal(s.state.settings.appearance!.revision, appearance.revision + 1);
});
test("stale arrangement cannot overwrite a newer client and failed save preserves prior state", async (t) => {
  const s = await setup(t);
  const library = structuredClone(s.state.settings.charms!);
  const c = {
    id: crypto.randomUUID(),
    type: "charms.save",
    revision: library.revision,
    library,
  };
  await s.command(c);
  await assert.rejects(
    s.command({ ...c, id: crypto.randomUUID() }),
    /another window/,
  );
  const before = structuredClone(s.state.settings.charms!);
  s.storage.save = async () => {
    throw Error("disk full");
  };
  await assert.rejects(
    s.command({ ...c, id: crypto.randomUUID(), revision: before.revision }),
    /disk full/,
  );
  assert.deepEqual(s.state.settings.charms, before);
});
test("studio settings migrate with a recovery copy and persist independently of note tab", async (t) => {
  const dir = await mkdtemp("/private/tmp/charme-studio-migrate-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const old = initialState();
  delete old.settings.theme;
  delete old.settings.hubTab;
  old.settings.lastTab = "notes";
  await writeFile(dir + "/state.json", JSON.stringify(old));
  const s = new Service(new Storage(dir));
  await s.initialize();
  assert.equal(s.state.settings.hubTab, "notes");
  assert.ok((await readdir(dir)).some((n) => n.startsWith("pre-studio-")));
  await s.command({
    id: crypto.randomUUID(),
    type: "settings",
    patch: { theme: "dark", hubTab: "charms" },
  });
  assert.equal(s.state.settings.lastTab, "notes");
  assert.equal(s.state.settings.theme, "dark");
  await assert.rejects(
    s.command({
      id: crypto.randomUUID(),
      type: "settings",
      patch: { theme: "invalid" },
    }),
    /Invalid charm/,
  );
});
