import test from "node:test";
import assert from "node:assert/strict";
test("settling does not schedule another frame; explicit Stop schedules one recovery frame", async () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => null },
  });
  const { CharmScene } = await import("../src/renderer/Scene");
  const scene = Object.create(CharmScene.prototype) as any;
  let frames = 0,
    sleeps = 0;
  scene.bodies = new Map([
    [
      "bottle",
      {
        setLinvel() {},
        setAngvel() {},
        sleep() {
          sleeps++;
        },
      },
    ],
  ]);
  scene.links = [];
  scene.grabbed = undefined;
  scene.wake = () => frames++;
  scene.stop(false);
  assert.equal(frames, 0);
  assert.equal(sleeps, 1);
  scene.stop();
  assert.equal(frames, 1);
  assert.equal(sleeps, 2);
  delete (globalThis as any).sessionStorage;
});
test("outer chains use rigid-length generated links and avoid own-charm collisions", async () => {
  const {
    tetherPoints,
    charmCollisionGroups,
    linkCollisionGroups,
    hoopCollisionGroups,
  } = await import("../src/shared/tether");
  const points = tetherPoints("extra0", 18, [-0.2, 0.4, 0]);
  for (let i = 1; i < points.length; i++)
    assert.ok(
      Math.abs(
        Math.hypot(...points[i].map((n, j) => n - points[i - 1][j])) - 0.03,
      ) < 1e-9,
    );
  assert.ok(points[5][0] < -0.31);
  assert.ok(points[5][1] > 0.3);
  const contact = (a: number, b: number) =>
    !!((a >>> 16) & (b & 65535)) && !!((b >>> 16) & (a & 65535));
  assert.equal(contact(charmCollisionGroups(0), linkCollisionGroups(0)), false);
  assert.equal(contact(charmCollisionGroups(0), linkCollisionGroups(1)), true);
  assert.equal(contact(linkCollisionGroups(0), linkCollisionGroups(1)), false);
  assert.equal(contact(charmCollisionGroups(0), charmCollisionGroups(1)), true);
  assert.equal(contact(hoopCollisionGroups, charmCollisionGroups(0)), true);
});

test("disposing a replaced scene releases its GPU context after marking it inactive", async () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => null },
  });
  const { CharmScene } = await import("../src/renderer/Scene");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldCancel = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { removeEventListener() {} },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => {},
  });
  try {
    const scene = Object.create(CharmScene.prototype) as any;
    const calls: string[] = [];
    scene.observer = {
      disconnect() {
        calls.push("observer");
      },
    };
    scene.release = () => calls.push("resources");
    scene.renderer = {
      dispose() {
        calls.push("renderer");
      },
      forceContextLoss() {
        assert.equal(scene.disposed, true);
        calls.push("context");
      },
      domElement: {
        remove() {
          calls.push("canvas");
        },
      },
    };
    scene.world = {
      free() {
        calls.push("world");
      },
    };
    scene.dispose();
    assert.deepEqual(calls, [
      "observer",
      "resources",
      "renderer",
      "context",
      "canvas",
      "world",
    ]);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else delete (globalThis as any).document;
    if (oldCancel)
      Object.defineProperty(globalThis, "cancelAnimationFrame", oldCancel);
    else delete (globalThis as any).cancelAnimationFrame;
    delete (globalThis as any).sessionStorage;
  }
});

test("connected generated-link paths retain both endpoints under randomized 3D motion", async () => {
  const { connectedTether, rimAnchor } = await import("../src/shared/tether");
  let seed = 421;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2000; i++) {
    const count = 1 + Math.floor(random() * 20),
      length = count * 0.03;
    const start: [number, number, number] = [random() * 0.4 - 0.2, 0.3, 0];
    const direction = [random() - 0.5, random() - 0.5, random() - 0.5];
    const norm = Math.hypot(...direction),
      radius = random() * length;
    const end = start.map((v, j) => v + (direction[j] / norm) * radius) as [
      number,
      number,
      number,
    ];
    const points = connectedTether(start, end, count);
    assert.deepEqual(points[0], start);
    assert.deepEqual(points.at(-1), end);
    for (let j = 1; j < points.length; j++)
      assert.ok(
        Math.hypot(...points[j].map((v, k) => v - points[j - 1][k])) <=
          0.03000001,
      );
    assert.ok(points.flat().every(Number.isFinite));
  }
  for (const scale of [0.85, 1, 1.35]) {
    const p = rimAnchor([-0.18, 0.29, 0], scale);
    assert.ok(Math.abs(Math.hypot(p[0], p[1] - 0.4) - 0.19 * scale) < 1e-10);
  }
  assert.throws(() => connectedTether([0, 0, 0], [1, 0, 0], 3), /reach/);
});
