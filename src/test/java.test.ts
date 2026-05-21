import test from "node:test";
import assert from "node:assert/strict";
import { requiredJavaMajor } from "../java/discovery.js";

test("requiredJavaMajor maps modern Minecraft versions", () => {
  assert.equal(requiredJavaMajor("1.16.5"), 8);
  assert.equal(requiredJavaMajor("1.17.1"), 16);
  assert.equal(requiredJavaMajor("1.18.2"), 17);
  assert.equal(requiredJavaMajor("1.20.4"), 17);
  assert.equal(requiredJavaMajor("1.20.5"), 21);
  assert.equal(requiredJavaMajor("1.21.4"), 21);
});
