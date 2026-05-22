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
  assert.match(result.stdout, /^Usage:\n  craft-runner \[--json\] <command>\n/);
  assert.match(result.stdout, /craft-runner java list/);
  assert.match(result.stdout, /craft-runner core info <id>/);
  assert.match(result.stdout, /craft-runner core remove <id>/);
  assert.match(result.stdout, /craft-runner server create --id <id>/);
  assert.match(result.stdout, /craft-runner server logs <id>/);
  assert.match(result.stdout, /craft-runner env \.\.\.    \(alias for server\)/);
  assert.equal(result.stdout.includes("\\n"), false);
});

test("CLI prints zsh completion script", async () => {
  const result = await execFileAsync("node", ["dist/bin/cli.js", "completion", "zsh"], { cwd: process.cwd() });
  assert.match(result.stdout, /^#compdef craft-runner craftr\n/);
  assert.match(result.stdout, /_craft_runner_env_ids/);
  assert.match(result.stdout, /\$words\[1\] env list --ids/);
  assert.match(result.stdout, /'remove:remove a cached core'/);
  assert.match(result.stdout, /'logs:read environment logs'/);
  assert.match(result.stdout, /'server:manage local Minecraft test servers'/);
});

test("CLI exposes read-only core and java utility commands", async () => {
  const providers = await execFileAsync("node", ["dist/bin/cli.js", "core", "providers"], { cwd: process.cwd() });
  assert.match(providers.stdout, /papermc-fill/);

  const validate = await execFileAsync("node", ["dist/bin/cli.js", "java", "validate", "1.16.5"], { cwd: process.cwd() });
  assert.match(validate.stdout, /Java is compatible/);
  assert.match(validate.stdout, /Minecraft requires\s+Java 8\+/);
});

test("CLI keeps JSON output behind --json", async () => {
  const result = await execFileAsync("node", ["dist/bin/cli.js", "--json", "java", "validate", "1.16.5"], { cwd: process.cwd() });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.required, 8);
  assert.equal(parsed.ok, true);
});

test("CLI can create a test server with a custom jar", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-cli-create-"));
  const jar = path.join(root, "server.jar");
  await fs.writeFile(jar, "fake jar");
  const env = {
    ...process.env,
    CRAFT_RUNNER_CACHE_DIR: path.join(root, "cache"),
    CRAFT_RUNNER_ENV_BASE_DIR: path.join(root, "envs"),
    CRAFT_RUNNER_STATE_DIR: path.join(root, "state")
  };
  const result = await execFileAsync("node", [
    "dist/bin/cli.js",
    "server",
    "create",
    "--id",
    "cli-create-test",
    "--path",
    jar,
    "--minecraft-version",
    "1.16.5"
  ], { cwd: process.cwd(), env });
  assert.match(result.stdout, /^Server\n/);
  assert.match(result.stdout, /ID\s+cli-create-test/);

  const list = await execFileAsync("node", ["dist/bin/cli.js", "server", "list"], { cwd: process.cwd(), env });
  assert.match(list.stdout, /cli-create-test/);
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
