import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveInside, validateServerId } from "../lib/fsx.js";

test("validateServerId accepts agent-friendly ids", () => {
  assert.doesNotThrow(() => validateServerId("paper_1.21-test"));
});

test("validateServerId rejects spaces and special characters", () => {
  assert.throws(() => validateServerId("paper test"));
  assert.throws(() => validateServerId("../bad"));
  assert.throws(() => validateServerId("bad:name"));
});

test("resolveInside prevents path traversal", () => {
  const base = path.resolve("/tmp/craft-runner-test");
  assert.equal(resolveInside(base, "plugins/Test.jar"), path.join(base, "plugins", "Test.jar"));
  assert.throws(() => resolveInside(base, "../outside"));
  assert.throws(() => resolveInside(base, "/tmp/outside"));
});
