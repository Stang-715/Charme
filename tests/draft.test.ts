import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeDraft } from "../src/shared/draft";
test("save acknowledgement preserves keystrokes entered during persistence", () => {
  const submitted = { title: "Thought", body: "First" };
  const current = { title: "Thought", body: "First and second" };
  const result = acknowledgeDraft(submitted, current, 7);
  assert.equal(result.clean, false);
  assert.deepEqual(result.pending, { ...current, revision: 7 });
  assert.deepEqual(result.saved, submitted);
});
test("only the acknowledged current draft becomes clean", () => {
  const current = { title: "नमस्ते", body: "café 🌿\nsecond line" };
  assert.deepEqual(acknowledgeDraft(current, current, 8), {
    saved: current,
    clean: true,
    pending: null,
  });
});
