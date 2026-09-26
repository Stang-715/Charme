import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultAppearance,
  validateAppearance,
} from "../src/shared/appearance";
import { fillHeight } from "../src/shared/hydration";
test("appearance defaults validate and prevent unreadable functional sizes", () => {
  const a = defaultAppearance();
  validateAppearance(a);
  a.scales.bottle = 0.5;
  assert.throws(() => validateAppearance(a), /85%/);
});
test("liquid volume calibration is monotonic and preserves endpoints", () => {
  assert.equal(fillHeight(0), 0);
  assert.equal(fillHeight(1), 1);
  for (let i = 1; i <= 100; i++)
    assert.ok(fillHeight(i / 100) > fillHeight((i - 1) / 100));
  assert.ok(
    fillHeight(0.2) > 0.2,
    "rounded bottom requires more than 20% height for 20% volume",
  );
});

test("layout envelope rejects severe overlaps and supports default optional slots", async () => {
  const { validateLayoutEnvelope } = await import("../src/shared/appearance");
  const a = defaultAppearance();
  validateLayoutEnvelope(a, { name: "Charme", extras: ["duck", "car"] });
  a.scales.notebook = 1.5;
  a.scales.companion = 1.5;
  a.links.notebook = 4;
  assert.throws(() => validateLayoutEnvelope(a, {}), /overlap/);
});
