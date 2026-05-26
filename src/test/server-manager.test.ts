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
  assert.equal(request.path, path.join(server.server_dir, "plugins", "fake-plugin.jar"));
  assert.equal(await fs.readFile(request.path, "utf8"), "fake plugin jar");
});

test("ServerManager removes timed out file mailbox requests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-debug-timeout-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  const fakeAgent = path.join(root, "fake-agent.jar");
  await fs.writeFile(fakeCore, "fake jar");
  await fs.writeFile(fakeAgent, "fake agent jar");

  const manager = new ServerManager(testConfig(root));
  const server = await manager.create({
    id: "debug-timeout-test",
    core_ref: {
      loader: "custom",
      minecraft_version: "1.20.4",
      path: fakeCore
    }
  });
  const installed = await manager.installDebugAgent(server.id, fakeAgent);
  const mailboxDir = installed.debug_agent?.mailbox_dir;
  assert.ok(mailboxDir);

  await assert.rejects(
    manager.debugEvalJs({
      server_id: server.id,
      code: "1 + 1",
      thread: "main",
      timeout_ms: 100
    }),
    /debug agent response timed out/
  );

  const requestFiles = await fs.readdir(path.join(mailboxDir, "requests"));
  assert.deepEqual(requestFiles.filter((file) => file.endsWith(".json")), []);
});

test("ServerManager can launch an existing direct core path without caching it", { skip: process.platform === "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-direct-core-test-"));
  const directCore = path.join(root, "existing-server.jar");
  const fakeJava = path.join(root, "fake-java");
  const javaArgsFile = path.join(root, "java-args.json");
  await fs.writeFile(directCore, "fake jar");
  await writeFakeJava(fakeJava);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.CRAFT_FAKE_JAVA_ARGS;
  process.env.PATH = path.join(root, "empty-bin");
  process.env.CRAFT_FAKE_JAVA_ARGS = javaArgsFile;
  try {
    const manager = new ServerManager(testConfig(root));
    const server = await manager.create({
      id: "direct-core-test",
      java_ref: `path:${fakeJava}`,
      core_ref: {
        loader: "custom",
        minecraft_version: "1.20.4",
        direct_path: directCore
      }
    });

    assert.equal(server.core_ref.direct_path, directCore);
    assert.equal((await manager.coreCache.list()).length, 0);

    const started = await manager.start(server.id);
    assert.equal(started.launch_backend, "background");
    const args = JSON.parse(await waitForFile(javaArgsFile)) as string[];
    assert.equal(args.includes(directCore), true);
    assert.equal(args.includes("nogui"), true);
    assert.equal((await manager.getEvents(server.id)).some((event) => event.type === "core_direct_path"), true);

    await manager.stop(server.id, 3000);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.CRAFT_FAKE_JAVA_ARGS;
    } else {
      process.env.CRAFT_FAKE_JAVA_ARGS = previousArgsFile;
    }
  }
});

test("ServerManager discovers manually installed agents and registers them as external servers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-discover-agent-test-"));
  const config = testConfig(root);
  const manager = new ServerManager(config);
  const endpointName = "41234";
  const endpoint = path.join(config.agents_dir, endpointName);
  await fs.mkdir(endpoint, { recursive: true });
  await fs.writeFile(path.join(endpoint, "config.json"), JSON.stringify({
    token: "manual-token",
    endpointName,
    pollIntervalMs: 250
  }));
  await fs.writeFile(path.join(endpoint, "endpoint.json"), JSON.stringify({
    schema: "craft-runner-agent-endpoint",
    version: 1,
    endpointName,
    endpoint,
    platform: "bukkit",
    serverPort: 41234,
    serverDir: path.join(root, "manual-server"),
    token: "manual-token",
    lastSeenAt: new Date().toISOString(),
    transports: [{ type: "file-mailbox", path: endpoint }]
  }));

  const discovered = await manager.discoverDebugAgents();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].endpoint_name, endpointName);
  assert.equal(discovered[0].temporary, true);
  assert.equal(discovered[0].deletable, false);

  const registered = await manager.registerDiscoveredAgent(endpointName, "manual-agent-test");
  assert.equal(registered.kind, "external");
  assert.equal(registered.deletable, false);
  assert.equal(registered.debug_agent?.token, "manual-token");
  assert.equal(registered.debug_agent?.mailbox_dir, endpoint);

  await assert.rejects(
    () => manager.destroy(registered.id),
    /cannot be destroyed/
  );
});

test("ServerManager marks stale external agents stopped even when mailbox directory remains", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-stale-agent-test-"));
  const config = testConfig(root);
  const manager = new ServerManager(config);
  const endpointName = "41235";
  const endpoint = path.join(config.agents_dir, endpointName);
  await fs.mkdir(endpoint, { recursive: true });
  await fs.writeFile(path.join(endpoint, "config.json"), JSON.stringify({
    token: "manual-token",
    endpointName,
    pollIntervalMs: 250
  }));
  await fs.writeFile(path.join(endpoint, "endpoint.json"), JSON.stringify({
    schema: "craft-runner-agent-endpoint",
    version: 1,
    endpointName,
    endpoint,
    platform: "bukkit",
    serverPort: 41235,
    serverDir: path.join(root, "manual-server"),
    token: "manual-token",
    lastSeenAt: "2020-01-01T00:00:00.000000000Z",
    socket: path.join(endpoint, "agent.sock"),
    transports: [{ type: "file-mailbox", path: endpoint }]
  }));

  const discovered = await manager.discoverDebugAgents();
  assert.equal(discovered[0].alive, false);
  assert.equal(discovered[0].stale, true);

  const registered = await manager.registerDiscoveredAgent(endpointName, "manual-stale-agent-test");
  assert.equal(registered.status, "stopped");

  await fs.writeFile(path.join(endpoint, "endpoint.json"), JSON.stringify({
    schema: "craft-runner-agent-endpoint",
    version: 1,
    endpointName,
    endpoint,
    platform: "bukkit",
    serverPort: 41235,
    serverDir: path.join(root, "manual-server"),
    token: "manual-token",
    lastSeenAt: new Date().toISOString(),
    transports: [{ type: "file-mailbox", path: endpoint }]
  }));
  const refreshed = await manager.get(registered.id);
  assert.equal(refreshed.status, "running");
});

test("ServerManager prefers tmux sessions and marks manually killed sessions stopped", { skip: process.platform === "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-tmux-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  const fakeJava = path.join(root, "fake-java");
  const fakeBin = path.join(root, "bin");
  const fakeTmux = path.join(fakeBin, "tmux");
  const tmuxState = path.join(root, "tmux-state");
  await fs.writeFile(fakeCore, "fake jar");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeFakeJava(fakeJava);
  await writeFakeTmux(fakeTmux);

  const previousPath = process.env.PATH;
  const previousTmuxState = process.env.CRAFT_FAKE_TMUX_STATE;
  process.env.PATH = fakeBin;
  process.env.CRAFT_FAKE_TMUX_STATE = tmuxState;
  try {
    const manager = new ServerManager(testConfig(root));
    const server = await manager.create({
      id: "tmux-test",
      java_ref: `path:${fakeJava}`,
      core_ref: {
        loader: "custom",
        minecraft_version: "1.20.4",
        path: fakeCore
      }
    });

    const started = await manager.start(server.id);
    assert.equal(started.launch_backend, "tmux");
    assert.match(started.tmux_session ?? "", /^craft_runner_/);
    assert.match(started.console_stdin_path ?? "", /\.craft-runner\/console\.stdin$/);
    assert.equal((await manager.get(server.id)).status, "running");

    const command = await fs.readFile(path.join(tmuxState, `${started.tmux_session}.cmd`), "utf8");
    assert.match(command, /nogui/);
    assert.match(command, /cat .*console\.stdin/);
    assert.match(command, /CRAFT_RUNNER_SERVER_ID/);

    const stopLine = readFirstLine(started.console_stdin_path!);
    const gracefullyStopped = await manager.stop(server.id, 100);
    assert.equal(await stopLine, "stop");
    assert.equal(gracefullyStopped.status, "stopped");

    const calls = await fs.readFile(path.join(tmuxState, "calls.log"), "utf8");
    assert.doesNotMatch(calls, /send-keys/);

    const restarted = await manager.start(server.id);
    await fs.rm(path.join(tmuxState, restarted.tmux_session!), { force: true });
    const stopped = await manager.get(server.id);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.pid, undefined);
    assert.equal(stopped.events.some((event) => event.type === "process_exit_detected"), true);
  } finally {
    process.env.PATH = previousPath;
    if (previousTmuxState === undefined) {
      delete process.env.CRAFT_FAKE_TMUX_STATE;
    } else {
      process.env.CRAFT_FAKE_TMUX_STATE = previousTmuxState;
    }
  }
});

test("ServerManager falls back to detached background process when tmux is unavailable", { skip: process.platform === "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-background-test-"));
  const fakeCore = path.join(root, "fake-server.jar");
  const fakeJava = path.join(root, "fake-java");
  const javaArgsFile = path.join(root, "java-args.json");
  await fs.writeFile(fakeCore, "fake jar");
  await writeFakeJava(fakeJava);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.CRAFT_FAKE_JAVA_ARGS;
  process.env.PATH = path.join(root, "empty-bin");
  process.env.CRAFT_FAKE_JAVA_ARGS = javaArgsFile;
  try {
    const manager = new ServerManager(testConfig(root));
    const server = await manager.create({
      id: "background-test",
      java_ref: `path:${fakeJava}`,
      core_ref: {
        loader: "custom",
        minecraft_version: "1.20.4",
        path: fakeCore
      }
    });

    const started = await manager.start(server.id);
    assert.equal(started.launch_backend, "background");
    assert.equal(typeof started.pid, "number");
    const args = JSON.parse(await waitForFile(javaArgsFile)) as string[];
    assert.equal(args.includes("nogui"), true);

    const stopped = await manager.stop(server.id, 3000);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.pid, undefined);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.CRAFT_FAKE_JAVA_ARGS;
    } else {
      process.env.CRAFT_FAKE_JAVA_ARGS = previousArgsFile;
    }
  }
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
    root_dir: path.join(root, "home"),
    cache_dir: path.join(root, "cache"),
    agents_dir: path.join(root, "home", "agents"),
    server_base_dir: path.join(root, "servers-base"),
    state_dir: path.join(root, "state"),
    user_agent: "craft-runner-test/1.0.1",
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

async function writeFakeJava(target: string): Promise<void> {
  await fs.writeFile(target, [
    `#!${process.execPath}`,
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    "if (args.includes('-version')) {",
    "  process.stderr.write('openjdk version \"21.0.1\"\\n');",
    "  process.exit(0);",
    "}",
    "if (process.env.CRAFT_FAKE_JAVA_ARGS) {",
    "  fs.writeFileSync(process.env.CRAFT_FAKE_JAVA_ARGS, JSON.stringify(args));",
    "}",
    "process.on('SIGTERM', () => process.exit(0));",
    "process.on('SIGINT', () => process.exit(0));",
    "setInterval(() => {}, 1000);"
  ].join("\n"));
  await fs.chmod(target, 0o755);
}

async function writeFakeTmux(target: string): Promise<void> {
  await fs.writeFile(target, [
    `#!${process.execPath}`,
    "const fs = require('fs');",
    "const path = require('path');",
    "const args = process.argv.slice(2);",
    "const state = process.env.CRAFT_FAKE_TMUX_STATE;",
    "fs.mkdirSync(state, { recursive: true });",
    "fs.appendFileSync(path.join(state, 'calls.log'), JSON.stringify(args) + '\\n');",
    "function valueAfter(flag) { const index = args.indexOf(flag); return index === -1 ? '' : args[index + 1]; }",
    "if (args[0] === '-V') { console.log('tmux 3.4'); process.exit(0); }",
    "if (args[0] === 'has-session') { process.exit(fs.existsSync(path.join(state, valueAfter('-t'))) ? 0 : 1); }",
    "if (args[0] === 'new-session') {",
    "  const session = valueAfter('-s');",
    "  fs.writeFileSync(path.join(state, session), 'running');",
    "  fs.writeFileSync(path.join(state, session + '.cmd'), args[args.length - 1]);",
    "  process.exit(0);",
    "}",
    "if (args[0] === 'display-message') { console.log('424242'); process.exit(0); }",
    "if (args[0] === 'kill-session') { fs.rmSync(path.join(state, valueAfter('-t')), { force: true }); process.exit(0); }",
    "process.exit(1);"
  ].join("\n"));
  await fs.chmod(target, 0o755);
}

async function readFirstLine(file: string): Promise<string> {
  const content = await fs.readFile(file, "utf8");
  return content.split(/\r?\n/)[0];
}

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + 3000;
  while (Date.now() <= deadline) {
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await sleep(25);
    }
  }
  throw new Error(`file was not written: ${file}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
