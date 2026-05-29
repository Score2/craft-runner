import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CoreCache } from "../core/cache.js";
import { CoreInstallationManager } from "../core/installation.js";
import { CraftRunnerConfig, ServerMetadata } from "../lib/types.js";

test("core installation prepares direct jars and materializes shareable dirs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-core-install-"));
  const source = path.join(root, "server.jar");
  await fs.writeFile(source, "fake jar");
  const cache = new CoreCache(testConfig(root));
  const core = await cache.importLocal("custom", "1.16.5", source);
  const installation = new CoreInstallationManager(cache);
  const server = serverMetadata(root, core.id);

  await fs.mkdir(server.server_dir, { recursive: true });
  const materialized = await installation.materialize(core, server);

  assert.equal(materialized.core_id, core.id);
  assert.equal(materialized.launch.command, "java");
  assert.deepEqual(materialized.launch.args.slice(-3), ["-jar", path.join(materialized.install_dir, "server.jar"), "nogui"]);

  const libraries = path.join(server.server_dir, "libraries");
  const cacheDir = path.join(server.server_dir, "cache");
  assert.equal((await fs.lstat(libraries)).isSymbolicLink(), true);
  assert.equal((await fs.lstat(cacheDir)).isSymbolicLink(), true);

  const listed = await cache.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, core.id);
});

test("installer core materialization includes root launch jars used by argfiles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-core-install-"));
  const cache = new CoreCache(testConfig(root));
  await cache.init();
  const core = await cache.save({
    id: "forge-1.21.4-54.1.16",
    loader: "forge",
    minecraft_version: "1.21.4",
    build: "1.21.4-54.1.16",
    provider: "test",
    source: "test",
    file_path: path.join(root, "installer.jar"),
    sha256: "test",
    checksum_source: "local",
    size: 0,
    kind: "installer",
    launch: { type: "installer", install_args: ["--installServer"] },
    downloaded_at: new Date().toISOString()
  });
  const installDir = cache.installDir(core);
  await fs.mkdir(path.join(installDir, "libraries", "net", "minecraftforge", "forge", "1.21.4-54.1.16"), { recursive: true });
  await fs.writeFile(path.join(installDir, ".craft-runner-installed"), "done");
  await fs.writeFile(path.join(installDir, "manifest.json"), JSON.stringify({ core_id: core.id }));
  await fs.writeFile(path.join(installDir, "run.sh"), "#!/bin/sh\n");
  await fs.writeFile(path.join(installDir, "user_jvm_args.txt"), "");
  await fs.writeFile(path.join(installDir, "forge-1.21.4-54.1.16-shim.jar"), "shim");
  await fs.writeFile(
    path.join(installDir, "libraries", "net", "minecraftforge", "forge", "1.21.4-54.1.16", "unix_args.txt"),
    "-Djava.net.preferIPv6Addresses=system -jar forge-1.21.4-54.1.16-shim.jar"
  );

  const installation = new CoreInstallationManager(cache);
  const server = serverMetadata(root, core.id);
  server.loader = "forge";
  server.minecraft_version = "1.21.4";
  await fs.mkdir(server.server_dir, { recursive: true });

  const materialized = await installation.materialize(core, server);

  assert.equal(materialized.launch.cwd, server.server_dir);
  assert.deepEqual(materialized.launch.args, [
    "@user_jvm_args.txt",
    "@libraries/net/minecraftforge/forge/1.21.4-54.1.16/unix_args.txt",
    "nogui"
  ]);
  assert.equal(await fs.readFile(path.join(server.server_dir, "forge-1.21.4-54.1.16-shim.jar"), "utf8"), "shim");
});

function testConfig(root: string): CraftRunnerConfig {
  return {
    root_dir: path.join(root, "home"),
    cache_dir: path.join(root, "cache"),
    agents_dir: path.join(root, "home", "agents"),
    server_base_dir: path.join(root, "servers"),
    state_dir: path.join(root, "state"),
    user_agent: "craft-runner-test/1.0.2",
    ports: {
      minecraft_start: 41000,
      minecraft_end: 41020,
      rcon_start: 51000,
      rcon_end: 51020
    },
    java: {
      default_ref: "system",
      default_xms: "128M",
      default_xmx: "256M",
      prefer_sdkman: true
    }
  };
}

function serverMetadata(root: string, coreId: string): ServerMetadata {
  const now = new Date().toISOString();
  return {
    id: "server-a",
    kind: "local",
    server_dir: path.join(root, "servers", "server-a", "server"),
    base_dir: path.join(root, "servers"),
    persistent: false,
    core_ref: { core_id: coreId },
    core_id: coreId,
    minecraft_version: "1.16.5",
    loader: "custom",
    host: "127.0.0.1",
    port: 41000,
    java_ref: "system",
    java_args: [],
    memory: { xms: "128M", xmx: "256M" },
    status: "created",
    created_at: now,
    updated_at: now,
    events: []
  };
}
