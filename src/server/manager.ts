import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { CoreCache } from "../core/cache.js";
import { resolveCore } from "../core/providers.js";
import { CoreInstallationManager } from "../core/installation.js";
import { allocatePort, releasePort } from "./ports.js";
import { loadConfig } from "../lib/config.js";
import {
  CreateServerInput,
  CraftRunnerConfig,
  DebugEvalInput,
  HotPluginInput,
  ServerEvent,
  ServerMetadata
} from "../lib/types.js";
import { ensureDir, pathExists, readJson, resolveInside, validateServerId, writeJson } from "../lib/fsx.js";
import { randomId } from "../lib/hash.js";
import { getJavaInfo, resolveJavaCommand, validateJavaForMinecraft } from "../java/discovery.js";
import { MetadataStore } from "../storage/metadata.js";
import { sendRconCommand } from "./rcon.js";

const execFileAsync = promisify(execFile);

type LaunchCommand = {
  command: string;
  args: string[];
};

export class ServerManager {
  readonly config: CraftRunnerConfig;
  readonly store: MetadataStore;
  readonly coreCache: CoreCache;
  readonly coreInstallation: CoreInstallationManager;

  constructor(config = loadConfig()) {
    this.config = config;
    this.store = new MetadataStore(config);
    this.coreCache = new CoreCache(config);
    this.coreInstallation = new CoreInstallationManager(this.coreCache);
  }

  async init(): Promise<void> {
    await this.store.init();
    await this.coreCache.init();
  }

  async create(input: CreateServerInput): Promise<ServerMetadata> {
    await this.init();
    const id = input.id ?? randomId("server");
    validateServerId(id);
    if (await this.store.getServer(id)) {
      throw new Error(`server already exists: ${id}`);
    }

    const core = await resolveCore(input.core_ref, this.coreCache);
    const javaRef = input.java_ref ?? this.config.java.default_ref;
    const validation = await validateJavaForMinecraft(javaRef, core.minecraft_version);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const baseDir = path.resolve(input.base_dir ?? this.config.server_base_dir);
    const serverDir = path.join(baseDir, "servers", id, "server");
    const port = input.port ?? await allocatePort(
      { start: this.config.ports.minecraft_start, end: this.config.ports.minecraft_end },
      this.store.locksDir()
    );
    const rconEnabled = input.rcon?.enabled === true;
    const rconPort = rconEnabled
      ? input.rcon?.port ?? await allocatePort(
        { start: this.config.ports.rcon_start, end: this.config.ports.rcon_end },
        this.store.locksDir()
      )
      : undefined;

    const now = new Date().toISOString();
    const server: ServerMetadata = {
      id,
      kind: "local",
      server_dir: serverDir,
      base_dir: baseDir,
      persistent: input.persistent ?? Boolean(input.base_dir),
      core_ref: input.core_ref,
      core_id: core.id,
      minecraft_version: core.minecraft_version,
      loader: core.loader,
      host: input.host ?? "127.0.0.1",
      port,
      rcon_port: rconPort,
      rcon_password: rconEnabled ? input.rcon?.password ?? randomId("rcon") : undefined,
      java_ref: javaRef,
      java_command: validation.java.command,
      java_args: input.java_args ?? [],
      memory: {
        xms: input.memory?.xms ?? this.config.java.default_xms,
        xmx: input.memory?.xmx ?? this.config.java.default_xmx
      },
      status: "created",
      created_at: now,
      updated_at: now,
      events: []
    };

    await ensureDir(serverDir);
    await ensureDir(path.join(baseDir, "servers", id, "logs"));
    await this.writeServerFiles(server, input.server_properties ?? {}, input.accept_eula ?? true);
    addEvent(server, "created", "Server created", { core_id: core.id, port });
    await this.store.saveServer(server);

    if (input.start) {
      return this.start(id);
    }
    return server;
  }

  async list(): Promise<ServerMetadata[]> {
    await this.init();
    const servers = await this.store.listServers();
    return Promise.all(servers.map((server) => this.refreshStatus(server)));
  }

  async stats(): Promise<Record<string, unknown>> {
    await this.init();
    const servers = await this.list();
    const cores = await this.coreCache.list();
    const statusCounts = countBy(servers, (server) => server.status);
    const loaderCounts = countBy(servers, (server) => server.loader);
    const serverEntries = await Promise.all(servers.map(async (server) => ({
      id: server.id,
      status: server.status,
      loader: server.loader,
      minecraft_version: server.minecraft_version,
      pid: server.pid,
      launch_backend: server.launch_backend,
      tmux_session: server.tmux_session,
      console_stdin_path: server.console_stdin_path,
      persistent: server.persistent,
      disk_bytes: await directorySize(path.join(server.base_dir, "servers", server.id))
    })));
    const serverBytes = serverEntries.reduce((sum, server) => sum + server.disk_bytes, 0);
    const coreFileBytes = cores.reduce((sum, core) => sum + core.size, 0);
    const coreCacheBytes = await directorySize(this.coreCache.coresDir);
    const cacheBytes = await directorySize(this.config.cache_dir);
    const serverBaseBytes = await directorySize(this.config.server_base_dir);
    const stateBytes = await directorySize(this.config.state_dir);

    return {
      generated_at: new Date().toISOString(),
      paths: {
        cache_dir: this.config.cache_dir,
        core_cache_dir: this.coreCache.coresDir,
        server_base_dir: this.config.server_base_dir,
        state_dir: this.config.state_dir
      },
      servers: {
        total: servers.length,
        running: statusCounts.running ?? 0,
        stopped: statusCounts.stopped ?? 0,
        created: statusCounts.created ?? 0,
        failed: statusCounts.failed ?? 0,
        by_status: statusCounts,
        by_loader: loaderCounts,
        persistent: servers.filter((server) => server.persistent).length,
        temporary: servers.filter((server) => !server.persistent).length,
        disk_bytes: serverBytes,
        instances: serverEntries.sort((a, b) => b.disk_bytes - a.disk_bytes)
      },
      cores: {
        total: cores.length,
        by_loader: countBy(cores, (core) => core.loader),
        file_bytes: coreFileBytes,
        cache_bytes: coreCacheBytes
      },
      disk: {
        cache_bytes: cacheBytes,
        core_cache_bytes: coreCacheBytes,
        server_base_bytes: serverBaseBytes,
        state_bytes: stateBytes,
        tracked_bytes: cacheBytes + serverBaseBytes + (this.config.state_dir.startsWith(this.config.cache_dir) ? 0 : stateBytes)
      }
    };
  }

  async get(id: string): Promise<ServerMetadata> {
    await this.init();
    const server = await this.store.getServer(id);
    if (!server) throw new Error(`server not found: ${id}`);
    return this.refreshStatus(server);
  }

  async start(id: string): Promise<ServerMetadata> {
    const server = await this.get(id);
    if (server.status === "running" && await isServerProcessRunning(server)) {
      return server;
    }
    const core = await this.coreCache.get(server.core_id);
    if (!core) throw new Error(`core not found: ${server.core_id}`);
    const java = await getJavaInfo(server.java_ref ?? "system");
    if (!java.valid) throw new Error(java.error ?? "selected Java is not valid");

    await ensureDir(server.server_dir);
    const materialized = await this.coreInstallation.materialize(core, server);
    const command = await buildLaunchCommand(server, materialized.launch);
    const runtime = await startServerProcess(server, command, java.command, this.stdoutLogPath(server));

    server.pid = runtime.pid;
    server.launch_backend = runtime.backend;
    server.tmux_session = runtime.tmux_session;
    server.console_stdin_path = runtime.console_stdin_path;
    server.status = "running";
    server.updated_at = new Date().toISOString();
    server.java_command = java.command;
    addEvent(server, "core_materialized", "Core installation materialized", {
      core_id: core.id,
      install_dir: materialized.install_dir,
      links: materialized.links
    });
    addEvent(server, "started", "Server started", {
      pid: runtime.pid,
      launch_backend: runtime.backend,
      tmux_session: runtime.tmux_session,
      console_stdin_path: runtime.console_stdin_path,
      command: command.command,
      args: command.args
    });
    await this.store.saveServer(server);
    return server;
  }

  async stop(id: string, timeoutMs = 15000): Promise<ServerMetadata> {
    const server = await this.get(id);
    server.status = "stopping";
    addEvent(server, "stopping", "Stopping server");
    await this.store.saveServer(server);

    await stopServerProcess(server, timeoutMs);

    server.status = "stopped";
    server.pid = undefined;
    server.updated_at = new Date().toISOString();
    addEvent(server, "stopped", "Server stopped");
    await this.store.saveServer(server);
    return server;
  }

  async kill(id: string): Promise<ServerMetadata> {
    const server = await this.get(id);
    const pid = server.pid;
    const tmuxRunning = await isTmuxServerRunning(server);
    if (!tmuxRunning && (!pid || !isProcessAlive(pid))) {
      server.status = "stopped";
      server.pid = undefined;
      server.updated_at = new Date().toISOString();
      addEvent(server, "kill_skipped", "No running tracked process to kill");
      await this.store.saveServer(server);
      return server;
    }

    addEvent(server, "killing", "Force killing server process", {
      pid,
      launch_backend: server.launch_backend,
      tmux_session: server.tmux_session
    });
    await this.store.saveServer(server);

    await killServerProcess(server);

    const stillRunning = await isServerProcessRunning(server);
    server.status = stillRunning ? "failed" : "stopped";
    if (server.status === "stopped") {
      server.pid = undefined;
    }
    server.updated_at = new Date().toISOString();
    addEvent(
      server,
      server.status === "stopped" ? "killed" : "kill_failed",
      server.status === "stopped" ? "Server process was force killed" : "Server process still appears to be alive after forced kill",
      { pid, launch_backend: server.launch_backend, tmux_session: server.tmux_session }
    );
    await this.store.saveServer(server);
    return server;
  }

  async restart(id: string): Promise<ServerMetadata> {
    await this.stop(id);
    return this.start(id);
  }

  async destroy(id: string, deleteFiles = true): Promise<{ id: string; deleted_files: boolean }> {
    const server = await this.get(id);
    if (server.status === "running" || server.status === "starting") {
      await this.stop(id);
    }
    await releasePort(this.store.locksDir(), server.port);
    await releasePort(this.store.locksDir(), server.rcon_port);
    await this.store.removeServer(id);
    if (deleteFiles && (!server.persistent || server.base_dir)) {
      await fs.rm(path.join(server.base_dir, "servers", server.id), { recursive: true, force: true });
      return { id, deleted_files: true };
    }
    return { id, deleted_files: false };
  }

  async putFile(id: string, targetPath: string, options: { content?: string; source_path?: string; overwrite?: boolean }): Promise<{ target: string; bytes: number }> {
    const server = await this.get(id);
    const target = resolveInside(server.server_dir, targetPath);
    if (!options.overwrite && await pathExists(target)) {
      throw new Error(`target already exists: ${targetPath}`);
    }
    await ensureDir(path.dirname(target));
    if (options.source_path) {
      await fs.copyFile(options.source_path, target);
    } else {
      await fs.writeFile(target, options.content ?? "");
    }
    const stat = await fs.stat(target);
    addEvent(server, "file_put", `Wrote ${targetPath}`, { bytes: stat.size });
    await this.store.saveServer(server);
    return { target, bytes: stat.size };
  }

  async addPlugin(id: string, pluginPath: string, pluginName?: string): Promise<{ target: string; bytes: number }> {
    const name = pluginName ?? path.basename(pluginPath);
    if (!name.endsWith(".jar")) throw new Error("plugin target name must end with .jar");
    return this.putFile(id, path.join("plugins", name), { source_path: pluginPath, overwrite: true });
  }

  async removeFile(id: string, targetPath: string): Promise<{ removed: string }> {
    const server = await this.get(id);
    const target = resolveInside(server.server_dir, targetPath);
    await fs.rm(target, { recursive: true, force: true });
    addEvent(server, "file_removed", `Removed ${targetPath}`);
    await this.store.saveServer(server);
    return { removed: targetPath };
  }

  async listFiles(id: string, relativePath = "."): Promise<string[]> {
    const server = await this.get(id);
    const root = resolveInside(server.server_dir, relativePath);
    const result: string[] = [];
    await collectFiles(root, server.server_dir, result);
    return result.sort();
  }

  async tailLog(id: string, lines = 120, file?: string): Promise<{ file: string; lines: string[] }> {
    const server = await this.get(id);
    const logFile = await this.resolveLogFile(server, file);
    const all = await readLines(logFile);
    return { file: logFile, lines: all.slice(Math.max(0, all.length - lines)) };
  }

  async readLog(id: string, options: { from_line?: number; to_line?: number; offset?: number; limit?: number; file?: string }): Promise<{ file: string; lines?: string[]; text?: string }> {
    const server = await this.get(id);
    const logFile = await this.resolveLogFile(server, options.file);
    if (options.offset !== undefined || options.limit !== undefined) {
      const handle = await fs.open(logFile, "r");
      try {
        const limit = options.limit ?? 8192;
        const buffer = Buffer.alloc(limit);
        const result = await handle.read(buffer, 0, limit, options.offset ?? 0);
        return { file: logFile, text: buffer.subarray(0, result.bytesRead).toString("utf8") };
      } finally {
        await handle.close();
      }
    }
    const lines = await readLines(logFile);
    const from = Math.max(1, options.from_line ?? 1);
    const to = Math.min(lines.length, options.to_line ?? lines.length);
    return { file: logFile, lines: lines.slice(from - 1, to) };
  }

  async waitReady(id: string, timeoutMs = 120000): Promise<{ ready: boolean; server: ServerMetadata; matched?: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const server = await this.get(id);
      const tail = await this.tailLog(id, 80).catch(() => ({ file: "", lines: [] }));
      const matched = tail.lines.find((line) => /Done \(|For help, type|Timings Reset/i.test(line));
      if (matched) return { ready: true, server, matched };
      if (server.status === "failed" || server.status === "stopped") return { ready: false, server };
      await sleep(1000);
    }
    return { ready: false, server: await this.get(id) };
  }

  async getEvents(id: string): Promise<ServerEvent[]> {
    return (await this.get(id)).events;
  }

  async sendCommand(id: string, command: string): Promise<{ response: string; transport: "rcon" | "console_stdin" }> {
    const server = await this.get(id);
    if (server.rcon_port && server.rcon_password) {
      const response = await sendRconCommand({
        host: server.host,
        port: server.rcon_port,
        password: server.rcon_password,
        command
      });
      addEvent(server, "command_sent", `Sent command through RCON: ${command}`, { transport: "rcon" });
      await this.store.saveServer(server);
      return { response, transport: "rcon" };
    }
    await writeConsoleCommand(server, command);
    addEvent(server, "command_sent", `Sent command through managed console stdin: ${command}`, { transport: "console_stdin" });
    await this.store.saveServer(server);
    return { response: "", transport: "console_stdin" };
  }

  async installDebugAgent(id: string, agentJarPath: string): Promise<ServerMetadata> {
    const server = await this.get(id);
    const token = server.debug_agent?.token ?? randomId("debug");
    const endpointName = String(server.port);
    const mailboxDir = path.join(server.server_dir, ".craft-runner-agent", endpointName);
    await ensureDir(path.join(mailboxDir, "requests"));
    await ensureDir(path.join(mailboxDir, "responses"));
    await ensureDir(path.join(mailboxDir, "tmp"));
    const targetJars = debugAgentTargets(server);
    for (const targetJar of targetJars) {
      await ensureDir(path.dirname(targetJar));
      await fs.copyFile(agentJarPath, targetJar);
    }
    await writeJson(path.join(mailboxDir, "config.json"), {
      token,
      endpointName,
      pollIntervalMs: 250
    });
    server.debug_agent = {
      token,
      mailbox_dir: mailboxDir,
      endpoint_name: endpointName,
      agent_jar: targetJars[0],
      agent_jars: targetJars,
      installed_at: new Date().toISOString()
    };
    addEvent(server, "debug_agent_installed", "Craft Runner debug agent installed", { mailbox_dir: mailboxDir, agent_jars: targetJars });
    await this.store.saveServer(server);
    return server;
  }

  async debugAgentStatus(id: string): Promise<Record<string, unknown>> {
    const server = await this.get(id);
    const endpointName = server.debug_agent?.endpoint_name ?? String(server.port);
    const mailboxDir = server.debug_agent?.mailbox_dir ?? path.join(server.server_dir, ".craft-runner-agent", endpointName);
    const agentJars = server.debug_agent?.agent_jars ?? (server.debug_agent?.agent_jar ? [server.debug_agent.agent_jar] : debugAgentTargets(server));
    return {
      server_id: server.id,
      configured: Boolean(server.debug_agent?.token),
      endpoint_name: endpointName,
      mailbox_dir: mailboxDir,
      endpoint_file: path.join(mailboxDir, "endpoint.json"),
      mailbox_exists: await pathExists(mailboxDir),
      agent_jar: agentJars[0],
      agent_jars: agentJars,
      agent_jar_exists: await pathExists(agentJars[0]),
      agent_jars_existing: await existingPaths(agentJars),
      requests_dir_exists: await pathExists(path.join(mailboxDir, "requests")),
      responses_dir_exists: await pathExists(path.join(mailboxDir, "responses")),
      endpoint_file_exists: await pathExists(path.join(mailboxDir, "endpoint.json")),
      installed_at: server.debug_agent?.installed_at
    };
  }

  async connectDebugAgent(id: string, connectCode: string): Promise<ServerMetadata> {
    const server = await this.get(id);
    const payload = decodeAgentConnectCode(connectCode);
    const token = requiredString(payload.token, "token");
    const mailboxDir = requiredString(payload.endpoint, "endpoint");
    const endpointName = typeof payload.endpointName === "string"
      ? payload.endpointName
      : String(payload.serverPort ?? server.port);
    const agentJars = debugAgentTargets(server);
    server.debug_agent = {
      token,
      mailbox_dir: mailboxDir,
      endpoint_name: endpointName,
      agent_jar: agentJars[0],
      agent_jars: agentJars,
      installed_at: new Date().toISOString()
    };
    addEvent(server, "debug_agent_connected", "Connected to manually installed Craft Runner debug agent", {
      mailbox_dir: mailboxDir,
      endpoint_name: endpointName
    });
    await this.store.saveServer(server);
    return server;
  }

  async debugEvalJs(input: DebugEvalInput): Promise<unknown> {
    const server = await this.get(input.server_id);
    if (!server.debug_agent?.token) {
      throw new Error("debug agent is not installed for this server");
    }
    return this.sendAgentRequest(server, {
      language: "js",
      thread: input.thread ?? "main",
      timeoutMs: input.timeout_ms ?? 5000,
      code: input.code
    }, "debug_eval_js", "Executed JS through debug agent");
  }

  async hotPlugin(input: HotPluginInput): Promise<unknown> {
    const server = await this.get(input.server_id);
    if (!server.debug_agent?.token) {
      throw new Error("debug agent is not installed for this server");
    }
    return this.sendAgentRequest(server, {
      language: "hot_plugin",
      thread: "main",
      timeoutMs: input.timeout_ms ?? 10000,
      action: input.action,
      path: input.path,
      pluginName: input.plugin_name,
      enable: input.enable ?? true
    }, "hot_plugin", `Hot plugin action: ${input.action}`);
  }

  private async sendAgentRequest(
    server: ServerMetadata,
    body: Record<string, unknown>,
    eventType: string,
    eventMessage: string
  ): Promise<unknown> {
    if (!server.debug_agent?.token) {
      throw new Error("debug agent is not installed for this server");
    }
    const mailboxDir = server.debug_agent.mailbox_dir;
    const requestId = randomId("req");
    const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : 5000;
    const request = {
      id: requestId,
      token: server.debug_agent.token,
      ...body
    };

    await ensureDir(path.join(mailboxDir, "requests"));
    await ensureDir(path.join(mailboxDir, "responses"));
    await ensureDir(path.join(mailboxDir, "tmp"));
    const tmpFile = path.join(mailboxDir, "tmp", `${requestId}-${crypto.randomUUID()}.json.tmp`);
    const requestFile = path.join(mailboxDir, "requests", `${requestId}.json`);
    await fs.writeFile(tmpFile, `${JSON.stringify(request, null, 2)}\n`);
    await fs.rename(tmpFile, requestFile);

    const responseFile = path.join(mailboxDir, "responses", `${requestId}.json`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await pathExists(responseFile)) {
        const response = await readJson<Record<string, unknown>>(responseFile, {});
        addEvent(server, eventType, eventMessage, {
          request_id: requestId,
          ok: response.ok
        });
        await this.store.saveServer(server);
        return response;
      }
      await sleep(100);
    }
    throw new Error(`debug agent response timed out after ${timeoutMs}ms; request id: ${requestId}`);
  }

  private async writeServerFiles(
    server: ServerMetadata,
    properties: Record<string, string | number | boolean>,
    acceptEula: boolean
  ): Promise<void> {
    await fs.writeFile(path.join(server.server_dir, "eula.txt"), `eula=${acceptEula ? "true" : "false"}\n`);
    const serverProperties = {
      "server-ip": server.host,
      "server-port": server.port,
      "enable-rcon": Boolean(server.rcon_port),
      ...(server.rcon_port ? { "rcon.port": server.rcon_port, "rcon.password": server.rcon_password ?? "" } : {}),
      ...properties
    };
    const content = Object.entries(serverProperties).map(([key, value]) => `${key}=${value}`).join("\n");
    await fs.writeFile(path.join(server.server_dir, "server.properties"), `${content}\n`);
  }

  private stdoutLogPath(server: ServerMetadata): string {
    return path.join(server.base_dir, "servers", server.id, "logs", "craft-runner-stdout.log");
  }

  private async resolveLogFile(server: ServerMetadata, file?: string): Promise<string> {
    if (file) {
      return resolveInside(server.server_dir, file);
    }
    const latest = path.join(server.server_dir, "logs", "latest.log");
    if (await pathExists(latest)) return latest;
    return this.stdoutLogPath(server);
  }

  private async refreshStatus(server: ServerMetadata): Promise<ServerMetadata> {
    if (!["running", "starting", "stopping"].includes(server.status)) {
      return server;
    }
    const running = await isServerProcessRunning(server);
    if (!running) {
      server.status = "stopped";
      server.pid = undefined;
      server.updated_at = new Date().toISOString();
      addEvent(server, "process_exit_detected", "Tracked server process/session is no longer running", {
        launch_backend: server.launch_backend,
        tmux_session: server.tmux_session
      });
      await this.store.saveServer(server);
    }
    return server;
  }
}

async function buildLaunchCommand(
  server: ServerMetadata,
  launch: { command: "java" | "sh" | "cmd"; args: string[] }
): Promise<LaunchCommand> {
  const java = await resolveJavaCommand(server.java_ref ?? "system");
  if (launch.command === "sh") {
    return { command: "sh", args: ensureNoGui(launch.args) };
  }
  if (launch.command === "cmd") {
    return { command: process.env.ComSpec ?? "cmd.exe", args: ensureNoGui(launch.args) };
  }
  return { command: java, args: ensureNoGui(memoryArgs(server).concat(server.java_args, launch.args)) };
}

async function startServerProcess(
  server: ServerMetadata,
  command: LaunchCommand,
  javaCommand: string,
  stdoutPath: string
): Promise<{ backend: "tmux" | "background"; pid?: number; tmux_session?: string; console_stdin_path?: string }> {
  await ensureDir(path.dirname(stdoutPath));
  if (await tmuxAvailable()) {
    try {
      return await startInTmux(server, command, javaCommand, stdoutPath);
    } catch (error) {
      addEvent(server, "tmux_start_failed", "tmux start failed; falling back to detached background process", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return startInBackground(server, command, javaCommand, stdoutPath);
}

async function startInTmux(
  server: ServerMetadata,
  command: LaunchCommand,
  javaCommand: string,
  stdoutPath: string
): Promise<{ backend: "tmux"; pid?: number; tmux_session: string; console_stdin_path: string }> {
  const session = server.tmux_session ?? tmuxSessionName(server);
  if (await tmuxSessionExists(session)) {
    throw new Error(`tmux session already exists: ${session}`);
  }
  const consoleStdinPath = server.console_stdin_path ?? path.join(server.server_dir, ".craft-runner", "console.stdin");
  await createNamedPipe(consoleStdinPath);
  const shellCommand = [
    `export JAVA=${shellQuote(javaCommand)}`,
    `export CRAFT_RUNNER_SERVER_ID=${shellQuote(server.id)}`,
    `while true; do cat ${shellQuote(consoleStdinPath)}; done | ${shellJoin([command.command, ...command.args])} >> ${shellQuote(stdoutPath)} 2>&1`
  ].join("; ");
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    session,
    "-c",
    server.server_dir,
    shellCommand
  ], {
    env: {
      ...process.env,
      JAVA: javaCommand,
      CRAFT_RUNNER_SERVER_ID: server.id
    },
    timeout: 10000
  });
  return {
    backend: "tmux",
    pid: await tmuxPanePid(session),
    tmux_session: session,
    console_stdin_path: consoleStdinPath
  };
}

function startInBackground(
  server: ServerMetadata,
  command: LaunchCommand,
  javaCommand: string,
  stdoutPath: string
): { backend: "background"; pid?: number } {
  const outFd = fsSync.openSync(stdoutPath, "a");
  const errFd = fsSync.openSync(stdoutPath, "a");
  try {
    const child = spawn(command.command, command.args, {
      cwd: server.server_dir,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      env: {
        ...process.env,
        JAVA: javaCommand,
        CRAFT_RUNNER_SERVER_ID: server.id
      }
    });
    child.unref();
    return { backend: "background", pid: child.pid };
  } finally {
    fsSync.closeSync(outFd);
    fsSync.closeSync(errFd);
  }
}

async function stopServerProcess(server: ServerMetadata, timeoutMs: number): Promise<void> {
  if (await isTmuxServerRunning(server)) {
    try {
      await writeConsoleCommand(server, "stop");
    } catch {
      // Session may already be gone or the console reader may have exited.
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && await tmuxSessionExists(server.tmux_session!)) {
      await sleep(250);
    }
    if (await tmuxSessionExists(server.tmux_session!)) {
      await tmuxKillSession(server.tmux_session!);
    }
    return;
  }
  if (server.pid && isProcessAlive(server.pid)) {
    try {
      process.kill(server.pid, "SIGTERM");
    } catch {
      // Process exited.
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isProcessAlive(server.pid)) {
      await sleep(250);
    }
    if (isProcessAlive(server.pid)) {
      try {
        process.kill(server.pid, "SIGKILL");
      } catch {
        // Process exited.
      }
    }
  }
}

async function killServerProcess(server: ServerMetadata): Promise<void> {
  if (await isTmuxServerRunning(server)) {
    await tmuxKillSession(server.tmux_session!);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && await tmuxSessionExists(server.tmux_session!)) {
      await sleep(100);
    }
    return;
  }
  if (server.pid && isProcessAlive(server.pid)) {
    try {
      process.kill(server.pid, "SIGKILL");
    } catch {
      // Process exited.
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isProcessAlive(server.pid)) {
      await sleep(100);
    }
  }
}

async function isServerProcessRunning(server: ServerMetadata): Promise<boolean> {
  if (await isTmuxServerRunning(server)) {
    return true;
  }
  return Boolean(server.pid && isProcessAlive(server.pid));
}

async function isTmuxServerRunning(server: ServerMetadata): Promise<boolean> {
  return Boolean(server.launch_backend === "tmux" && server.tmux_session && await tmuxSessionExists(server.tmux_session));
}

async function writeConsoleCommand(server: ServerMetadata, command: string): Promise<void> {
  if (!server.console_stdin_path) {
    throw new Error("server does not have a managed console stdin path; enable RCON or restart under tmux");
  }
  if (!(await isServerProcessRunning(server))) {
    throw new Error("server is not running");
  }
  await execFileAsync(shellCommand(), [
    "-c",
    "printf '%s\\n' \"$1\" > \"$2\"",
    "craft-runner-console",
    command,
    server.console_stdin_path
  ], { timeout: 5000 });
}

async function createNamedPipe(file: string): Promise<void> {
  await fs.rm(file, { force: true });
  await ensureDir(path.dirname(file));
  await execFileAsync(mkfifoCommand(), [file], { timeout: 3000 });
}

function mkfifoCommand(): string {
  return fsSync.existsSync("/usr/bin/mkfifo") ? "/usr/bin/mkfifo" : "mkfifo";
}

function shellCommand(): string {
  return fsSync.existsSync("/bin/sh") ? "/bin/sh" : "sh";
}

async function tmuxAvailable(): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }
  try {
    await execFileAsync("tmux", ["-V"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function tmuxSessionExists(session: string): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["has-session", "-t", session], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function tmuxPanePid(session: string): Promise<number | undefined> {
  try {
    const result = await execFileAsync("tmux", ["display-message", "-p", "-t", session, "#{pane_pid}"], { timeout: 3000 });
    const pid = Number(result.stdout.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function tmuxKillSession(session: string): Promise<void> {
  try {
    await execFileAsync("tmux", ["kill-session", "-t", session], { timeout: 3000 });
  } catch {
    // Session already disappeared.
  }
}

function tmuxSessionName(server: ServerMetadata): string {
  const suffix = crypto.createHash("sha1").update(server.server_dir).digest("hex").slice(0, 10);
  const id = server.id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
  return `craft_runner_${suffix}_${id}`;
}

function ensureNoGui(args: string[]): string[] {
  return args.some((arg) => arg.toLowerCase() === "nogui" || arg.toLowerCase() === "-nogui")
    ? args
    : args.concat("nogui");
}

function shellJoin(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function memoryArgs(server: ServerMetadata): string[] {
  return [`-Xms${server.memory.xms}`, `-Xmx${server.memory.xmx}`];
}

function debugAgentTargets(server: ServerMetadata): string[] {
  const modLoaders = new Set(["fabric", "forge", "neoforge"]);
  const pluginLoaders = new Set(["bukkit", "craftbukkit", "spigot", "paper", "purpur", "folia", "bungee", "bungeecord", "waterfall", "velocity"]);
  if (modLoaders.has(server.loader)) {
    return [path.join(server.server_dir, "mods", "craft-runner-agent.jar")];
  }
  if (pluginLoaders.has(server.loader)) {
    return [path.join(server.server_dir, "plugins", "craft-runner-agent.jar")];
  }
  return [
    path.join(server.server_dir, "plugins", "craft-runner-agent.jar"),
    path.join(server.server_dir, "mods", "craft-runner-agent.jar")
  ];
}

async function existingPaths(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const item of paths) {
    if (await pathExists(item)) {
      result.push(item);
    }
  }
  return result;
}

function addEvent(server: ServerMetadata, type: string, message: string, data?: Record<string, unknown>): void {
  server.events.push({ at: new Date().toISOString(), type, message, data });
  server.updated_at = new Date().toISOString();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function decodeAgentConnectCode(connectCode: string): Record<string, any> {
  try {
    const padded = connectCode.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(connectCode.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (!payload || payload.schema !== "craft-runner-agent-connect") {
      throw new Error("invalid schema");
    }
    return payload;
  } catch (error) {
    throw new Error(`invalid craft-runner agent connect code: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`connect code is missing ${name}`);
  }
  return value;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectFiles(root: string, base: string, result: string[]): Promise<void> {
  if (!(await pathExists(root))) return;
  const stat = await fs.stat(root);
  if (stat.isFile()) {
    result.push(path.relative(base, root));
    return;
  }
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    await collectFiles(path.join(root, entry.name), base, result);
  }
}

async function directorySize(root: string): Promise<number> {
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory()) {
      return stat.size;
    }
    let total = stat.size;
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isSymbolicLink()) {
        total += (await fs.lstat(full)).size;
      } else if (entry.isDirectory()) {
        total += await directorySize(full);
      } else {
        total += (await fs.lstat(full)).size;
      }
    }
    return total;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
      return 0;
    }
    throw error;
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item) || "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function readLines(file: string): Promise<string[]> {
  try {
    return (await fs.readFile(file, "utf8")).split(/\r?\n/);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}
