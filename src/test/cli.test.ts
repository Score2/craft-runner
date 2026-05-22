import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("CLI help prints real newlines", async () => {
  const result = await execFileAsync("node", ["dist/bin/cli.js", "--help"], { cwd: process.cwd() });
  assert.match(result.stdout, /^Usage:\n  craft-runner java list\n/);
  assert.equal(result.stdout.includes("\\n"), false);
});
