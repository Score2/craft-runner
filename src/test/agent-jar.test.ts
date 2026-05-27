import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("agent jar is a slim single artifact and loads GraalJS as runtime libraries", async () => {
  const jar = path.join(process.cwd(), "agent", "build", "libs", "craft-runner-agent-1.0.2.jar");
  const stat = await fs.stat(jar);
  assert.ok(stat.size < 6 * 1024 * 1024, `agent jar should stay slim, got ${stat.size} bytes`);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-agent-jar-"));
  await execFileAsync("jar", ["xf", jar, "META-INF/MANIFEST.MF"], { cwd: root });
  const manifest = await fs.readFile(path.join(root, "META-INF", "MANIFEST.MF"), "utf8");
  assert.match(manifest, /^Multi-Release: true\r?$/m);

  const listing = await execFileAsync("jar", ["tf", jar], { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
  assert.doesNotMatch(listing.stdout, /com\/oracle\/truffle\//);
  assert.doesNotMatch(listing.stdout, /org\/graalvm\/polyglot\/Context\.class/);
  assert.doesNotMatch(listing.stdout, /lombok\//);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/js\/GraalJsLibraries\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/BrigadierAgentCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/CloudAgentCommandRegistrar\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/AgentCommandContext\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/api\/CraftRunnerDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/api\/CommonDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/AgentCommandController\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/AgentHelpCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/AgentHotCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/command\/AgentInfoCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/hot\/HotPluginExecutor\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/runtime\/AgentRuntime\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/mailbox\/FileMailbox\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/reflect\/HotReflection\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bukkit\/api\/BukkitDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bukkit\/command\/CloudBukkitAgentCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bukkit\/hot\/BukkitHotPluginOperations\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bungee\/api\/BungeeDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bungee\/command\/CloudBungeeAgentCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bungee\/hot\/BungeeHotPluginOperations\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/velocity\/api\/VelocityDebugApi\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/velocity\/command\/CloudVelocityAgentCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/velocity\/hot\/VelocityHotPluginOperations\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/bungee\/CraftRunnerBungeePlugin\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/velocity\/CraftRunnerVelocityPlugin\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/fabric\/command\/FabricAgentCommand\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/forge\/CraftRunnerForgeMod\.class/);
  assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/platform\/neoforge\/CraftRunnerNeoForgeMod\.class/);
  assert.match(listing.stdout, /org\/incendo\/cloud\/CommandManager\.class/);
  assert.match(listing.stdout, /bungee\.yml/);
  assert.match(listing.stdout, /velocity-plugin\.json/);
});
