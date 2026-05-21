import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveInside, validateEnvironmentId } from "../lib/fsx.js";

test("validateEnvironmentId accepts agent-friendly ids", () => {
  assert.doesNotThrow(() => validateEnvironmentId("paper_1.21-test"));
});

test("validateEnvironmentId rejects spaces and special characters", () => {
  assert.throws(() => validateEnvironmentId("paper test"));
  assert.throws(() => validateEnvironmentId("../bad"));
  assert.throws(() => validateEnvironmentId("bad:name"));
});

test("resolveInside prevents path traversal", () => {
  const base = path.resolve("/tmp/craft-runner-test");
  assert.equal(resolveInside(base, "plugins/Test.jar"), path.join(base, "plugins", "Test.jar"));
  assert.throws(() => resolveInside(base, "../outside"));
  assert.throws(() => resolveInside(base, "/tmp/outside"));
});
