import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentJarName } from "../debug/agentJar.js";

const execFileAsync = promisify(execFile);

const jars = [
  "craft-runner-agent-bukkit",
  "craft-runner-agent-bungee",
  "craft-runner-agent-velocity",
  "craft-runner-agent-fabric",
  "craft-runner-agent-forge-legacy",
  "craft-runner-agent-forge-modern",
  "craft-runner-agent-neoforge-legacy",
  "craft-runner-agent-neoforge-modern"
];

test("agent platform jars are slim and keep GraalJS as runtime libraries", async () => {
  for (const name of jars) {
    const jar = path.join(process.cwd(), "agent", "build", "libs", `${name}.jar`);
    const stat = await fs.stat(jar);
    assert.ok(stat.size < 6 * 1024 * 1024, `${name} should stay slim, got ${stat.size} bytes`);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-agent-jar-"));
    await execFileAsync("jar", ["xf", jar, "META-INF/MANIFEST.MF"], { cwd: root });
    const manifest = await fs.readFile(path.join(root, "META-INF", "MANIFEST.MF"), "utf8");
    assert.doesNotMatch(manifest, /^Multi-Release: true\r?$/m);

    const listing = await execFileAsync("jar", ["tf", jar], { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
    assert.doesNotMatch(listing.stdout, /com\/oracle\/truffle\//);
    assert.doesNotMatch(listing.stdout, /org\/graalvm\/polyglot\/Context\.class/);
    assert.doesNotMatch(listing.stdout, /com\/google\/gson\//);
    assert.doesNotMatch(listing.stdout, /lombok\//);
    assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/runtime\/AgentRuntime\.class/);
    assert.match(listing.stdout, /io\/insinuate\/score2\/craftrunner\/agent\/common\/mailbox\/FileMailbox\.class/);
  }
});

test("NeoForge split jars use loader metadata for their compatibility line", async () => {
  const legacy = path.join(process.cwd(), "agent", "build", "libs", "craft-runner-agent-neoforge-legacy.jar");
  const modern = path.join(process.cwd(), "agent", "build", "libs", "craft-runner-agent-neoforge-modern.jar");
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-neoforge-legacy-"));
  const modernRoot = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-neoforge-modern-"));

  await execFileAsync("jar", ["xf", legacy, "META-INF/mods.toml"], { cwd: legacyRoot });
  await execFileAsync("jar", ["xf", modern, "META-INF/neoforge.mods.toml"], { cwd: modernRoot });

  const legacyMetadata = await fs.readFile(path.join(legacyRoot, "META-INF", "mods.toml"), "utf8");
  const modernMetadata = await fs.readFile(path.join(modernRoot, "META-INF", "neoforge.mods.toml"), "utf8");
  assert.ok(legacyMetadata.includes('loaderVersion = "[2,)"'));
  assert.ok(modernMetadata.includes('loaderVersion = "[4,)"'));
});

test("agent descriptors expand the package version placeholder", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
  const descriptors = new Map([
    ["craft-runner-agent-bukkit", "plugin.yml"],
    ["craft-runner-agent-bungee", "bungee.yml"],
    ["craft-runner-agent-velocity", "velocity-plugin.json"],
    ["craft-runner-agent-fabric", "fabric.mod.json"],
    ["craft-runner-agent-forge-legacy", "META-INF/mods.toml"],
    ["craft-runner-agent-forge-modern", "META-INF/mods.toml"],
    ["craft-runner-agent-neoforge-legacy", "META-INF/mods.toml"],
    ["craft-runner-agent-neoforge-modern", "META-INF/neoforge.mods.toml"]
  ]);

  for (const [name, descriptor] of descriptors) {
    const jar = path.join(process.cwd(), "agent", "build", "libs", `${name}.jar`);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-agent-descriptor-"));
    await execFileAsync("jar", ["xf", jar, descriptor], { cwd: root });
    const content = await fs.readFile(path.join(root, descriptor), "utf8");
    assert.doesNotMatch(content, /\$\{version\}/);
    assert.match(content, new RegExp(escapeRegExp(packageJson.version)));
  }

  const velocityJar = path.join(process.cwd(), "agent", "build", "libs", "craft-runner-agent-velocity.jar");
  const javap = await execFileAsync("javap", [
    "-classpath",
    velocityJar,
    "-verbose",
    "io.insinuate.score2.craftrunner.agent.platform.velocity.CraftRunnerVelocityPlugin"
  ], { maxBuffer: 20 * 1024 * 1024 });
  assert.match(javap.stdout, new RegExp(escapeRegExp(packageJson.version)));
});

test("agent platform jars contain only their platform entrypoints", async () => {
  const expected = new Map([
    ["craft-runner-agent-bukkit", [/plugin\.yml/, /platform\/bukkit\/CraftRunnerBukkitPlugin\.class/]],
    ["craft-runner-agent-bungee", [/bungee\.yml/, /platform\/bungee\/CraftRunnerBungeePlugin\.class/]],
    ["craft-runner-agent-velocity", [/velocity-plugin\.json/, /platform\/velocity\/CraftRunnerVelocityPlugin\.class/]],
    ["craft-runner-agent-fabric", [/fabric\.mod\.json/, /platform\/fabric\/CraftRunnerFabricMod\.class/]],
    ["craft-runner-agent-forge-legacy", [/META-INF\/mods\.toml/, /platform\/forge\/CraftRunnerForgeMod\.class/]],
    ["craft-runner-agent-forge-modern", [/META-INF\/mods\.toml/, /platform\/forge\/CraftRunnerForgeMod\.class/]],
    ["craft-runner-agent-neoforge-legacy", [/META-INF\/mods\.toml/, /platform\/neoforge\/CraftRunnerNeoForgeMod\.class/]],
    ["craft-runner-agent-neoforge-modern", [/META-INF\/neoforge\.mods\.toml/, /platform\/neoforge\/CraftRunnerNeoForgeMod\.class/]]
  ]);

  for (const [name, patterns] of expected) {
    const jar = path.join(process.cwd(), "agent", "build", "libs", `${name}.jar`);
    const listing = await execFileAsync("jar", ["tf", jar], { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
    for (const pattern of patterns) {
      assert.match(listing.stdout, pattern, `${name} should contain ${pattern}`);
    }
  }
});

test("agent platform jars keep Java 17 legacy bytecode and Java 21 modern bytecode", async () => {
  const commonClass = "io/insinuate/score2/craftrunner/agent/common/runtime/AgentRuntime.class";
  const platformClasses = new Map([
    ["craft-runner-agent-bukkit", ["io/insinuate/score2/craftrunner/agent/platform/bukkit/CraftRunnerBukkitPlugin.class", 61]],
    ["craft-runner-agent-bungee", ["io/insinuate/score2/craftrunner/agent/platform/bungee/CraftRunnerBungeePlugin.class", 61]],
    ["craft-runner-agent-velocity", ["io/insinuate/score2/craftrunner/agent/platform/velocity/CraftRunnerVelocityPlugin.class", 61]],
    ["craft-runner-agent-fabric", ["io/insinuate/score2/craftrunner/agent/platform/fabric/CraftRunnerFabricMod.class", 61]],
    ["craft-runner-agent-forge-legacy", ["io/insinuate/score2/craftrunner/agent/platform/forge/CraftRunnerForgeMod.class", 61]],
    ["craft-runner-agent-forge-modern", ["io/insinuate/score2/craftrunner/agent/platform/forge/CraftRunnerForgeMod.class", 65]],
    ["craft-runner-agent-neoforge-legacy", ["io/insinuate/score2/craftrunner/agent/platform/neoforge/CraftRunnerNeoForgeMod.class", 61]],
    ["craft-runner-agent-neoforge-modern", ["io/insinuate/score2/craftrunner/agent/platform/neoforge/CraftRunnerNeoForgeMod.class", 65]]
  ] as const);

  for (const [name, [platformClass, expectedMajor]] of platformClasses) {
    const jar = path.join(process.cwd(), "agent", "build", "libs", `${name}.jar`);
    assert.equal(await classMajorVersion(jar, commonClass), 61, `${name} common classes should remain Java 17`);
    assert.equal(await classMajorVersion(jar, platformClass), expectedMajor, `${name} platform bytecode mismatch`);
  }
});

test("agent jar selector only splits platforms with real compatibility boundaries", () => {
  assert.equal(agentJarName("paper", "1.20.4"), "craft-runner-agent-bukkit");
  assert.equal(agentJarName("paper", "1.20.5"), "craft-runner-agent-bukkit");
  assert.equal(agentJarName("folia", "1.21.4"), "craft-runner-agent-bukkit");
  assert.equal(agentJarName("forge", "1.20.1"), "craft-runner-agent-forge-legacy");
  assert.equal(agentJarName("forge", "1.21.4"), "craft-runner-agent-forge-modern");
  assert.equal(agentJarName("neoforge", "1.20.4"), "craft-runner-agent-neoforge-legacy");
  assert.equal(agentJarName("neoforge", "1.21.1"), "craft-runner-agent-neoforge-modern");
  assert.equal(agentJarName("velocity", "unknown"), "craft-runner-agent-velocity");
});

async function classMajorVersion(jar: string, entry: string): Promise<number> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-agent-class-"));
  await execFileAsync("jar", ["xf", jar, entry], { cwd: root });
  const bytes = await fs.readFile(path.join(root, entry));
  return bytes.readUInt16BE(6);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
