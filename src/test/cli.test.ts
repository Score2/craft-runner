import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("CLI help prints real newlines", async () => {
  const result = await execFileAsync("node", ["dist/bin/cli.js", "--help"], { cwd: process.cwd() });
  assert.match(result.stdout, /^Usage:\n  craft-runner java list\n/);
  assert.match(result.stdout, /craft-runner core info <id>/);
  assert.match(result.stdout, /craft-runner core remove <id>/);
  assert.match(result.stdout, /craft-runner env logs <id>/);
  assert.equal(result.stdout.includes("\\n"), false);
});

test("CLI prints zsh completion script", async () => {
  const result = await execFileAsync("node", ["dist/bin/cli.js", "completion", "zsh"], { cwd: process.cwd() });
  assert.match(result.stdout, /^#compdef craft-runner craftr\n/);
  assert.match(result.stdout, /_craft_runner_env_ids/);
  assert.match(result.stdout, /\$words\[1\] env list --ids/);
  assert.match(result.stdout, /'remove:remove a cached core'/);
  assert.match(result.stdout, /'logs:read environment logs'/);
});

test("CLI exposes read-only core and java utility commands", async () => {
  const providers = await execFileAsync("node", ["dist/bin/cli.js", "core", "providers"], { cwd: process.cwd() });
  assert.match(providers.stdout, /papermc-fill/);

  const validate = await execFileAsync("node", ["dist/bin/cli.js", "java", "validate", "1.16.5"], { cwd: process.cwd() });
  assert.match(validate.stdout, /"required": 8/);
});

test("CLI installs zsh completion to an explicit directory", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-completion-"));
  const result = await execFileAsync("node", ["dist/bin/cli.js", "completion", "install", "zsh", "--dir", dir], { cwd: process.cwd() });
  const target = path.join(dir, "_craft-runner");
  const aliasTarget = path.join(dir, "_craftr");
  assert.match(result.stdout, new RegExp(JSON.stringify(target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(1, -1)));
  assert.match(result.stdout, new RegExp(JSON.stringify(aliasTarget).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(1, -1)));
  assert.match(await fs.readFile(target, "utf8"), /^#compdef craft-runner craftr\n/);
  assert.match(await fs.readFile(aliasTarget, "utf8"), /^#compdef craft-runner craftr\n/);
});
