import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { CoreCache } from "../core/cache.js";
import { resolveCore } from "../core/providers.js";
import { CoreInstallationManager } from "../core/installation.js";
import { allocatePort, releasePort } from "./ports.js";
import { loadConfig } from "../lib/config.js";
import {
  CreateServerInput,
  CraftRunnerConfig,
  DebugEvalInput,
  ServerEvent,
  ServerMetadata
} from "../lib/types.js";
import { ensureDir, pathExists, readJson, resolveInside, validateServerId, writeJson } from "../lib/fsx.js";
import { randomId } from "../lib/hash.js";
import { getJavaInfo, resolveJavaCommand, validateJavaForMinecraft } from "../java/discovery.js";
import { MetadataStore } from "../storage/metadata.js";
import { sendRconCommand } from "./rcon.js";

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
    if (server.status === "running" && server.pid && isProcessAlive(server.pid)) {
      return server;
    }
    const core = await this.coreCache.get(server.core_id);
    if (!core) throw new Error(`core not found: ${server.core_id}`);
    const java = await getJavaInfo(server.java_ref ?? "system");
    if (!java.valid) throw new Error(java.error ?? "selected Java is not valid");

    await ensureDir(server.server_dir);
    const materialized = await this.coreInstallation.materialize(core, server);
    const command = await buildLaunchCommand(server, materialized.launch);
    const stdoutPath = this.stdoutLogPath(server);
    await ensureDir(path.dirname(stdoutPath));
    const outFd = fsSync.openSync(stdoutPath, "a");
    const errFd = fsSync.openSync(stdoutPath, "a");
    const child = spawn(command.command, command.args, {
      cwd: server.server_dir,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      env: {
        ...process.env,
        JAVA: java.command,
        CRAFT_RUNNER_SERVER_ID: server.id
      }
    });
    child.unref();
    fsSync.closeSync(outFd);
    fsSync.closeSync(errFd);

    server.pid = child.pid;
    server.status = "running";
    server.updated_at = new Date().toISOString();
    server.java_command = java.command;
    addEvent(server, "core_materialized", "Core installation materialized", {
      core_id: core.id,
      install_dir: materialized.install_dir,
      links: materialized.links
    });
    addEvent(server, "started", "Server started", { pid: child.pid, command: command.command, args: command.args });
    await this.store.saveServer(server);
    return server;
  }

  async stop(id: string, timeoutMs = 15000): Promise<ServerMetadata> {
    const server = await this.get(id);
    server.status = "stopping";
    addEvent(server, "stopping", "Stopping server");
    await this.store.saveServer(server);

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

    server.status = "stopped";
    server.pid = undefined;
    server.updated_at = new Date().toISOString();
    addEvent(server, "stopped", "Server stopped");
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

  async sendCommand(id: string, command: string): Promise<{ response: string }> {
    const server = await this.get(id);
    if (!server.rcon_port || !server.rcon_password) {
      throw new Error("RCON is not enabled for this server");
    }
    const response = await sendRconCommand({
      host: server.host,
      port: server.rcon_port,
      password: server.rcon_password,
      command
    });
    addEvent(server, "command_sent", `Sent command: ${command}`);
    await this.store.saveServer(server);
    return { response };
  }

  async installDebugAgent(id: string, agentJarPath: string): Promise<ServerMetadata> {
    const server = await this.get(id);
    const token = server.debug_agent?.token ?? randomId("debug");
    const mailboxDir = path.join(server.server_dir, ".craft-runner-agent");
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
      pollIntervalMs: 250
    });
    server.debug_agent = {
      token,
      mailbox_dir: mailboxDir,
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
    const mailboxDir = server.debug_agent?.mailbox_dir ?? path.join(server.server_dir, ".craft-runner-agent");
    const agentJars = server.debug_agent?.agent_jars ?? (server.debug_agent?.agent_jar ? [server.debug_agent.agent_jar] : debugAgentTargets(server));
    return {
      server_id: server.id,
      configured: Boolean(server.debug_agent?.token),
      mailbox_dir: mailboxDir,
      mailbox_exists: await pathExists(mailboxDir),
      agent_jar: agentJars[0],
      agent_jars: agentJars,
      agent_jar_exists: await pathExists(agentJars[0]),
      agent_jars_existing: await existingPaths(agentJars),
      requests_dir_exists: await pathExists(path.join(mailboxDir, "requests")),
      responses_dir_exists: await pathExists(path.join(mailboxDir, "responses")),
      installed_at: server.debug_agent?.installed_at
    };
  }

  async debugEvalJs(input: DebugEvalInput): Promise<unknown> {
    const server = await this.get(input.server_id);
    if (!server.debug_agent?.token) {
      throw new Error("debug agent is not installed for this server");
    }
    const mailboxDir = server.debug_agent.mailbox_dir;
    const requestId = randomId("req");
    const timeoutMs = input.timeout_ms ?? 5000;
    const request = {
      id: requestId,
      token: server.debug_agent.token,
      language: "js",
      thread: input.thread ?? "main",
      timeoutMs,
      code: input.code
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
        addEvent(server, "debug_eval_js", "Executed JS through debug agent", {
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
    if (server.pid && server.status === "running" && !isProcessAlive(server.pid)) {
      server.status = "stopped";
      server.pid = undefined;
      server.updated_at = new Date().toISOString();
      addEvent(server, "process_exit_detected", "Tracked process is no longer running");
      await this.store.saveServer(server);
    }
    return server;
  }
}

async function buildLaunchCommand(
  server: ServerMetadata,
  launch: { command: "java" | "sh" | "cmd"; args: string[] }
): Promise<{ command: string; args: string[] }> {
  const java = await resolveJavaCommand(server.java_ref ?? "system");
  if (launch.command === "sh") {
    return { command: "sh", args: launch.args };
  }
  if (launch.command === "cmd") {
    return { command: process.env.ComSpec ?? "cmd.exe", args: launch.args };
  }
  return { command: java, args: memoryArgs(server).concat(server.java_args, launch.args) };
}

function memoryArgs(server: ServerMetadata): string[] {
  return [`-Xms${server.memory.xms}`, `-Xmx${server.memory.xmx}`];
}

function debugAgentTargets(server: ServerMetadata): string[] {
  const modLoaders = new Set(["fabric", "forge", "neoforge"]);
  const pluginLoaders = new Set(["bukkit", "craftbukkit", "spigot", "paper", "purpur", "folia"]);
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
