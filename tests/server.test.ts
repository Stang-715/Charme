import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Service } from "../src/main/service";
import { Storage } from "../src/main/storage";
import { startServer } from "../src/main/server";
test("dashboard authenticates reads, rejects foreign origins, and consumes launch tokens once", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "charme-http-"));
  const service = new Service(new Storage(dir));
  await service.initialize();
  const d = await startServer(service, path.resolve("dist"));
  t.after(async () => {
    d.server.closeAllConnections();
    await new Promise<void>((r) => d.server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal((await fetch(d.origin + "/api/state")).status, 401);
  const token = new URL(d.launchUrl()).hash.slice(1);
  const exchange = () =>
    fetch(d.origin + "/api/session", {
      method: "POST",
      headers: { Origin: d.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  const response = await exchange();
  assert.equal(response.status, 200);
  const { session } = await response.json();
  assert.equal((await exchange()).status, 401);
  assert.equal(
    (
      await fetch(d.origin + "/api/state", {
        headers: { Authorization: `Bearer ${session}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(d.origin + "/api/state", {
        headers: {
          Authorization: `Bearer ${session}`,
          Origin: "https://evil.example",
        },
      })
    ).status,
    403,
  );
  const command = { id: crypto.randomUUID(), type: "water.add", ml: 350 };
  assert.equal(
    (
      await fetch(d.origin + "/api/command", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(d.origin + "/api/command", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session}`,
          Origin: d.origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      })
    ).status,
    200,
  );
  assert.equal(service.state.drinks.length, 1);
  const model = await readFile("public/models/duck.glb");
  assert.equal(
    (
      await fetch(d.origin + "/api/assets", {
        method: "POST",
        headers: { Origin: d.origin },
        body: model,
      })
    ).status,
    401,
  );
  const beforeValidate = service.state.revision;
  const validated = await fetch(d.origin + "/api/assets/validate", { method: "POST", headers: { Origin: d.origin, Authorization: `Bearer ${session}`, "X-Asset-Name": "duck.glb" }, body: model });
  assert.equal(validated.status, 200);
  assert.ok((await validated.json()).triangles > 0);
  assert.equal(service.state.revision, beforeValidate);
  assert.equal(service.state.settings.charms!.assets.length, 0);
  assert.equal((await fetch(d.origin + "/api/assets/validate", { method: "POST", headers: { Authorization: `Bearer ${session}` }, body: model })).status, 400);
  const imported = await fetch(d.origin + "/api/assets", {
    method: "POST",
    headers: {
      Origin: d.origin,
      Authorization: `Bearer ${session}`,
      "X-Asset-Name": "duck.glb",
    },
    body: model,
  });
  assert.equal(imported.status, 200);
  const asset = await imported.json();
  assert.equal((await fetch(d.origin + "/api/assets/" + asset.id)).status, 401);
  const assetResponse = await fetch(d.origin + "/api/assets/" + asset.id, {
    headers: { Authorization: `Bearer ${session}` },
  });
  assert.equal(assetResponse.status, 200);
  assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), model);
  const exported = await fetch(d.origin + "/api/export", {
    headers: { Authorization: `Bearer ${session}` },
  });
  assert.equal(exported.status, 200);
  const restored = await fetch(d.origin + "/api/restore-archive", {
    method: "POST",
    headers: { Origin: d.origin, Authorization: `Bearer ${session}` },
    body: await exported.arrayBuffer(),
  });
  assert.equal(restored.status, 200);
});
