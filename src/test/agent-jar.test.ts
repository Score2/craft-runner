import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("agent jar preserves Graal multi-release metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-agent-jar-"));
  const jar = path.join(process.cwd(), "agent", "build", "libs", "craft-runner-agent-0.1.0.jar");

  await execFileAsync("jar", ["xf", jar, "META-INF/MANIFEST.MF"], { cwd: root });
  const manifest = await fs.readFile(path.join(root, "META-INF", "MANIFEST.MF"), "utf8");
  assert.match(manifest, /^Multi-Release: true\r?$/m);

  const listing = await execFileAsync("jar", ["tf", jar], { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
  assert.match(listing.stdout, /META-INF\/versions\/9\/com\/oracle\/truffle\/api\/impl\/CheckMultiReleaseSupport\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/CraftRunnerDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/CommonDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/AgentCommandController\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/hot\/HotPluginExecutor\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bukkit\/BukkitDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bukkit\/hot\/BukkitHotPluginOperations\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bungee\/hot\/BungeeHotPluginOperations\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/velocity\/hot\/VelocityHotPluginOperations\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bungee\/CraftRunnerBungeePlugin\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/velocity\/CraftRunnerVelocityPlugin\.class/);
  assert.match(listing.stdout, /org\/incendo\/cloud\/CommandManager\.class/);
  assert.match(listing.stdout, /bungee\.yml/);
  assert.match(listing.stdout, /velocity-plugin\.json/);
});
