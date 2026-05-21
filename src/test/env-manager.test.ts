import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../env/manager.js";
import { CraftRunnerConfig } from "../lib/types.js";

test("EnvironmentManager creates env, writes files, injects files, and reads log ranges", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  await fs.writeFile(fakeCore, "fake jar");

  const config: CraftRunnerConfig = {
    cache_dir: path.join(root, "cache"),
    env_base_dir: path.join(root, "envs-base"),
    state_dir: path.join(root, "state"),
    user_agent: "craft-runner-test/0.1.0",
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

  const manager = new EnvironmentManager(config);
  const env = await manager.create({
    id: "test-env",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.16.5",
      path: fakeCore
    }
  });

  assert.equal(env.id, "test-env");
  assert.equal(env.port >= 41000 && env.port <= 41020, true);
  assert.equal(await fs.readFile(path.join(env.server_dir, "eula.txt"), "utf8"), "eula=true\n");

  await manager.putFile(env.id, "plugins/config.yml", { content: "enabled: true\n" });
  assert.equal(await fs.readFile(path.join(env.server_dir, "plugins", "config.yml"), "utf8"), "enabled: true\n");

  await fs.mkdir(path.join(env.server_dir, "logs"), { recursive: true });
  await fs.writeFile(path.join(env.server_dir, "logs", "latest.log"), "a\nb\nc\nd\n");
  assert.deepEqual((await manager.tailLog(env.id, 2)).lines, ["d", ""]);
  assert.deepEqual((await manager.readLog(env.id, { from_line: 2, to_line: 3 })).lines, ["b", "c"]);

  await manager.destroy(env.id);
  assert.equal((await manager.list()).length, 0);
});
