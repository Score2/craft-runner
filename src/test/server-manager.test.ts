import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ServerManager } from "../server/manager.js";
import { CraftRunnerConfig } from "../lib/types.js";

test("ServerManager creates server, writes files, injects files, and reads log ranges", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  await fs.writeFile(fakeCore, "fake jar");

  const config = testConfig(root);
  const manager = new ServerManager(config);
  const server = await manager.create({
    id: "test-server",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.16.5",
      path: fakeCore
    }
  });

  assert.equal(server.id, "test-server");
  assert.equal(server.port >= 41000 && server.port <= 41020, true);
  assert.equal(await fs.readFile(path.join(server.server_dir, "eula.txt"), "utf8"), "eula=true\n");

  await manager.putFile(server.id, "plugins/config.yml", { content: "enabled: true\n" });
  assert.equal(await fs.readFile(path.join(server.server_dir, "plugins", "config.yml"), "utf8"), "enabled: true\n");

  await fs.mkdir(path.join(server.server_dir, "logs"), { recursive: true });
  await fs.writeFile(path.join(server.server_dir, "logs", "latest.log"), "a\nb\nc\nd\n");
  assert.deepEqual((await manager.tailLog(server.id, 2)).lines, ["d", ""]);
  assert.deepEqual((await manager.readLog(server.id, { from_line: 2, to_line: 3 })).lines, ["b", "c"]);

  const stats = await manager.stats();
  assert.equal((stats.servers as Record<string, unknown>).total, 1);
  assert.equal((stats.servers as Record<string, unknown>).created, 1);
  assert.equal((stats.cores as Record<string, unknown>).total, 1);
  assert.equal(typeof (stats.disk as Record<string, unknown>).tracked_bytes, "number");

  await manager.destroy(server.id);
  assert.equal((await manager.list()).length, 0);
});

test("ServerManager installs debug agent and exchanges JS requests through file mailbox", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-debug-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  const fakeAgent = path.join(root, "fake-agent.jar");
  await fs.writeFile(fakeCore, "fake jar");
  await fs.writeFile(fakeAgent, "fake agent jar");

  const manager = new ServerManager(testConfig(root));
  const server = await manager.create({
    id: "debug-eval-test",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.20.4",
      path: fakeCore
    }
  });
  const installed = await manager.installDebugAgent(server.id, fakeAgent);
  assert.ok(installed.debug_agent?.token);

  const responder = respondToFirstDebugRequest(installed.debug_agent.mailbox_dir, {
    ok: true,
    result: {
      type: "number",
      value: 2
    },
    durationMs: 1
  });
  const response = await manager.debugEvalJs({
    server_id: server.id,
    code: "1 + 1",
    thread: "main",
    timeout_ms: 3000
  });

  assert.deepEqual(response, {
    id: await responder,
    ok: true,
    result: {
      type: "number",
      value: 2
    },
    durationMs: 1
  });
});

test("ServerManager sends structured hot plugin requests through file mailbox", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-hot-plugin-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  const fakeAgent = path.join(root, "fake-agent.jar");
  const fakePlugin = path.join(root, "fake-plugin.jar");
  await fs.writeFile(fakeCore, "fake jar");
  await fs.writeFile(fakeAgent, "fake agent jar");
  await fs.writeFile(fakePlugin, "fake plugin jar");

  const manager = new ServerManager(testConfig(root));
  const server = await manager.create({
    id: "hot-plugin-test",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.20.4",
      path: fakeCore
    }
  });
  const installed = await manager.installDebugAgent(server.id, fakeAgent);
  assert.ok(installed.debug_agent?.token);

  const responder = respondToFirstDebugRequest(installed.debug_agent.mailbox_dir, {
    ok: true,
    result: {
      action: "load",
      loaded: true,
      plugin: { name: "Example", version: "1.0.0", enabled: true },
      warnings: []
    },
    durationMs: 2
  });
  const response = await manager.hotPlugin({
    server_id: server.id,
    action: "load",
    path: fakePlugin,
    timeout_ms: 3000
  });

  assert.deepEqual(response, {
    id: await responder,
    ok: true,
    result: {
      action: "load",
      loaded: true,
      plugin: { name: "Example", version: "1.0.0", enabled: true },
      warnings: []
    },
    durationMs: 2
  });

  const request = JSON.parse(await fs.readFile(path.join(installed.debug_agent.mailbox_dir, "requests", `${(response as { id: string }).id}.json`), "utf8"));
  assert.equal(request.language, "hot_plugin");
  assert.equal(request.action, "load");
  assert.equal(request.path, fakePlugin);
});

test("ServerManager registers manually installed agent connect codes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-connect-agent-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  await fs.writeFile(fakeCore, "fake jar");

  const manager = new ServerManager(testConfig(root));
  const server = await manager.create({
    id: "connect-agent-test",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.20.4",
      path: fakeCore
    }
  });
  const endpoint = path.join(server.server_dir, ".craft-runner-agent", String(server.port));
  const code = Buffer.from(JSON.stringify({
    schema: "craft-runner-agent-connect",
    version: 1,
    endpointName: String(server.port),
    endpoint,
    token: "manual-token",
    serverPort: server.port
  }), "utf8").toString("base64url");

  const connected = await manager.connectDebugAgent(server.id, code);
  assert.equal(connected.debug_agent?.token, "manual-token");
  assert.equal(connected.debug_agent?.mailbox_dir, endpoint);
  assert.equal(connected.debug_agent?.endpoint_name, String(server.port));
});

test("ServerManager force kills a tracked server process", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-kill-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  await fs.writeFile(fakeCore, "fake jar");

  const manager = new ServerManager(testConfig(root));
  const server = await manager.create({
    id: "kill-test",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.16.5",
      path: fakeCore
    }
  });

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: true
  });
  child.unref();

  server.pid = child.pid;
  server.status = "running";
  await manager.store.saveServer(server);

  const killed = await manager.kill(server.id);
  assert.equal(killed.status, "stopped");
  assert.equal(killed.pid, undefined);
  assert.equal(killed.events.some((event) => event.type === "killed"), true);
});

function testConfig(root: string): CraftRunnerConfig {
  return {
    cache_dir: path.join(root, "cache"),
    server_base_dir: path.join(root, "servers-base"),
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
}

async function respondToFirstDebugRequest(
  mailboxDir: string,
  response: Record<string, unknown>
): Promise<string> {
  const requestsDir = path.join(mailboxDir, "requests");
  const responsesDir = path.join(mailboxDir, "responses");
  const tmpDir = path.join(mailboxDir, "tmp");
  const deadline = Date.now() + 1000;

  while (Date.now() <= deadline) {
    const files = await fs.readdir(requestsDir).catch(() => []);
    const requestFile = files.find((file) => file.endsWith(".json"));
    if (requestFile) {
      const request = JSON.parse(await fs.readFile(path.join(requestsDir, requestFile), "utf8")) as { id: string };
      const body = {
        id: request.id,
        ...response
      };
      const tmpFile = path.join(tmpDir, `${request.id}.json.tmp`);
      await fs.writeFile(tmpFile, `${JSON.stringify(body)}\n`);
      await fs.rename(tmpFile, path.join(responsesDir, `${request.id}.json`));
      return request.id;
    }
    await sleep(25);
  }

  throw new Error("debug request file was not written");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
