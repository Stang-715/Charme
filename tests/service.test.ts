import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Service } from "../src/main/service";
import { Storage } from "../src/main/storage";
import { FOCUS, REST, waterTotal } from "../src/shared/model";
async function setup(t: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "charme-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 0,
    wall = new Date(2026, 8, 22, 10);
  const service = new Service(
    new Storage(dir),
    () => wall,
    () => clock,
  );
  await service.initialize();
  await service.command({ id: crypto.randomUUID(), type: "onboard" });
  return {
    service,
    dir,
    advance: (ms: number) => {
      clock += ms;
      wall = new Date(wall.getTime() + ms);
    },
    cmd: (type: string, data: Record<string, unknown> = {}) =>
      service.command({ id: crypto.randomUUID(), type, ...data }),
  };
}
test("45/15 transitions are durable and unique", async (t) => {
  const { service, advance, dir } = await setup(t);
  advance(FOCUS);
  await service.tick();
  assert.equal(service.state.timer.phase, "rest");
  assert.equal(service.state.timer.remainingMs, REST);
  assert.equal(service.state.sessions.length, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")).sessions
      .length,
    1,
  );
  await service.tick();
  assert.equal(service.state.sessions.length, 1);
  advance(REST);
  await service.tick();
  assert.equal(service.state.timer.phase, "focus");
});
test("lock and sleep overlap without premature resume; manual intent survives", async (t) => {
  const { service, advance, cmd } = await setup(t);
  advance(1000);
  await service.block("lock", true);
  await service.block("sleep", true);
  advance(60000);
  await service.block("sleep", false);
  advance(60000);
  await service.tick();
  assert.equal(service.state.timer.remainingMs, FOCUS - 1000);
  await service.block("lock", false);
  advance(1000);
  await service.tick();
  assert.equal(service.state.timer.remainingMs, FOCUS - 2000);
  await cmd("timer.pause");
  await service.block("sleep", true);
  advance(10000);
  await service.block("sleep", false);
  advance(1000);
  await service.tick();
  assert.equal(service.state.timer.remainingMs, FOCUS - 2000);
});
test("water uses exact mixed volumes and deduplicates a retried command", async (t) => {
  const { service, cmd } = await setup(t);
  await cmd("settings", { patch: { goalMl: 2000 } });
  await cmd("water.add", { ml: 1000 });
  const id = crypto.randomUUID();
  await service.command({ id, type: "water.add", ml: 350 });
  await service.command({ id, type: "water.add", ml: 350 });
  await Promise.all([
    cmd("water.add", { ml: 350 }),
    cmd("water.add", { ml: 350 }),
  ]);
  assert.equal(waterTotal(service.state, "2026-09-22"), 2050);
  assert.equal(service.state.drinks.length, 4);
});
test("reset undo restores paused snapshot and removes interrupted record", async (t) => {
  const { service, cmd, advance } = await setup(t);
  advance(1000);
  await service.tick();
  await cmd("timer.reset");
  assert.equal(service.state.sessions[0].status, "interrupted");
  advance(1000);
  await cmd("timer.undo");
  assert.equal(service.state.timer.remainingMs, FOCUS - 1000);
  assert.equal(service.state.timer.intent, false);
  assert.equal(service.state.sessions.length, 0);
});
test("stale note update cannot resurrect a deleted note", async (t) => {
  const { service, cmd } = await setup(t);
  await cmd("note.add", { title: "Draft", body: "Keep this" });
  const n = service.state.notes[0];
  await cmd("note.delete", { itemId: n.id, revision: n.revision });
  await assert.rejects(
    cmd("note.update", {
      itemId: n.id,
      revision: n.revision,
      title: "Draft",
      body: "new",
    }),
    /deleted elsewhere/,
  );
  assert.equal(service.state.notes.length, 0);
});
test("clean restart resumes intent without elapsed closed time", async (t) => {
  const { service, advance, dir } = await setup(t);
  advance(9000);
  await service.close();
  const next = new Service(new Storage(dir));
  await next.initialize();
  assert.equal(next.state.timer.remainingMs, FOCUS - 9000);
  assert.equal(next.state.timer.intent, true);
});
test("crash restores matching checkpoint paused", async (t) => {
  const { service, advance, dir } = await setup(t);
  advance(16000);
  await service.tick();
  const next = new Service(new Storage(dir));
  await next.initialize();
  assert.equal(next.state.timer.remainingMs, FOCUS - 16000);
  assert.equal(next.state.timer.intent, false);
  assert.equal(next.recovered, true);
});
test("future schema is preserved rather than replaced by backup", async (t) => {
  const { dir } = await setup(t);
  await writeFile(
    path.join(dir, "state.json"),
    JSON.stringify({ schema: 999 }),
  );
  await assert.rejects(new Storage(dir).load(), /Unsupported data version/);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")).schema,
    999,
  );
});
test("failed persistence does not acknowledge water or lose previous durable data", async (t) => {
  const { service, cmd } = await setup(t);
  const original = service.storage.save;
  service.storage.save = async () => {
    throw Object.assign(Error("Disk full"), { code: "ENOSPC" });
  };
  await assert.rejects(cmd("water.add", { ml: 350 }), /Disk full/);
  assert.equal(service.state.drinks.length, 0);
  assert.ok(service.blockers.has("storage"));
  service.storage.save = original;
  await cmd("storage.retry");
  assert.equal(service.blockers.has("storage"), false);
});
test("midnight preserves history; deleting yesterday does not reset today reminder", async (t) => {
  const { service, cmd, advance } = await setup(t);
  await cmd("water.add", { ml: 350 });
  const old = service.state.drinks[0];
  await service.block("sleep", true);
  advance(15 * 3600000);
  await service.block("sleep", false);
  await service.tick();
  assert.equal(service.state.reminderDate, "2026-09-23");
  advance(10000);
  await service.tick();
  const remaining = service.state.reminderRemainingMs;
  await cmd("water.delete", { itemId: old.id });
  assert.equal(service.state.reminderRemainingMs, remaining);
  assert.equal(service.state.dailyGoals["2026-09-22"], 1750);
  await cmd("settings", { patch: { goalMl: 2000 } });
  assert.equal(service.state.dailyGoals["2026-09-22"], 1750);
  assert.equal(service.state.dailyGoals["2026-09-23"], 2000);
});
test("hydration reminder continues during manually paused focus", async (t) => {
  const { service, cmd, advance } = await setup(t);
  await cmd("timer.pause");
  advance(3600000);
  await service.tick();
  assert.equal(service.state.timer.remainingMs, FOCUS);
  assert.equal(service.state.reminderRemainingMs, 0);
  await cmd("water.snooze");
  assert.equal(service.state.reminderRemainingMs, 900000);
});
test("reset exactly at focus boundary completes focus once", async (t) => {
  const { service, cmd, advance } = await setup(t);
  advance(FOCUS);
  await cmd("timer.reset");
  assert.equal(service.state.sessions.length, 1);
  assert.equal(service.state.sessions[0].status, "completed");
  assert.equal(service.state.timer.phase, "focus");
  await cmd("timer.undo");
  assert.equal(service.state.timer.phase, "rest");
  assert.equal(service.state.timer.intent, false);
});
test("restore pauses timer and invalidates old item revisions", async (t) => {
  const { service, cmd } = await setup(t);
  await cmd("note.add", { title: "Thought", body: "Keep" });
  const backup = service.snapshot().state;
  const old = backup.notes[0];
  await service.restore(backup);
  assert.equal(service.state.timer.intent, false);
  assert.ok(service.state.notes[0].revision > old.revision);
  await assert.rejects(
    cmd("note.update", {
      itemId: old.id,
      revision: old.revision,
      title: "Stale",
      body: "Old draft",
    }),
    /changed/,
  );
});
test("reset removes managed backups but keeps user-named exports", async (t) => {
  const { service, dir, cmd } = await setup(t);
  await cmd("water.add", { ml: 350 });
  await service.storage.atomic("pre-restore-123.json", service.state);
  await service.storage.atomic("pre-seven-charms-123.json", service.state);
  await service.storage.atomic("my-export.json", service.state);
  await service.resetAll();
  assert.equal(service.state.drinks.length, 0);
  assert.equal(service.state.onboarded, false);
  await assert.rejects(readFile(path.join(dir, "backup.json")));
  await assert.rejects(readFile(path.join(dir, "pre-restore-123.json")));
  await assert.rejects(readFile(path.join(dir, "pre-seven-charms-123.json")));
  assert.ok(await readFile(path.join(dir, "my-export.json")));
});

test("appearance apply rejects a stale editor revision and keeps the accepted layout", async (t) => {
  const { service, cmd } = await setup(t);
  const first = structuredClone(service.state.settings.appearance!);
  first.scales.bottle = 1.1;
  await cmd("appearance.save", { appearance: first, revision: 0 });
  await assert.rejects(
    cmd("appearance.save", { appearance: first, revision: 0 }),
    /another window/,
  );
  assert.equal(service.state.settings.appearance!.scales.bottle, 1.1);
  assert.equal(service.state.settings.appearance!.revision, 1);
});
test("settings reject stale field edits without overwriting a remote change", async (t) => {
  const { service, cmd } = await setup(t);
  await cmd("settings", { patch: { goalMl: 2000 } });
  await assert.rejects(
    cmd("settings", { patch: { goalMl: 2500 }, expected: { goalMl: 1750 } }),
    /another window/,
  );
  assert.equal(service.state.settings.goalMl, 2000);
});
