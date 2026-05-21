import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { CoreCache } from "../core/cache.js";
import { resolveCore } from "../core/providers.js";
import { allocatePort, releasePort } from "./ports.js";
import { loadConfig } from "../lib/config.js";
import {
  CreateEnvironmentInput,
  CraftRunnerConfig,
  EnvironmentEvent,
  EnvironmentMetadata
} from "../lib/types.js";
import { ensureDir, pathExists, resolveInside, validateEnvironmentId, writeJson } from "../lib/fsx.js";
import { randomId } from "../lib/hash.js";
import { getJavaInfo, resolveJavaCommand, validateJavaForMinecraft } from "../java/discovery.js";
import { MetadataStore } from "../storage/metadata.js";
import { sendRconCommand } from "./rcon.js";

export class EnvironmentManager {
  readonly config: CraftRunnerConfig;
  readonly store: MetadataStore;
  readonly coreCache: CoreCache;

  constructor(config = loadConfig()) {
    this.config = config;
    this.store = new MetadataStore(config);
    this.coreCache = new CoreCache(config);
  }

  async init(): Promise<void> {
    await this.store.init();
    await this.coreCache.init();
  }

  async create(input: CreateEnvironmentInput): Promise<EnvironmentMetadata> {
    await this.init();
    const id = input.id ?? randomId("env");
    validateEnvironmentId(id);
    if (await this.store.getEnvironment(id)) {
      throw new Error(`environment already exists: ${id}`);
    }

    const core = await resolveCore(input.core_ref, this.coreCache);
    const javaRef = input.java_ref ?? this.config.java.default_ref;
    const validation = await validateJavaForMinecraft(javaRef, core.minecraft_version);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const baseDir = path.resolve(input.base_dir ?? this.config.env_base_dir);
    const serverDir = path.join(baseDir, "envs", id, "server");
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
    const env: EnvironmentMetadata = {
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
    await ensureDir(path.join(baseDir, "envs", id, "logs"));
    await this.writeServerFiles(env, input.server_properties ?? {}, input.accept_eula ?? true);
    addEvent(env, "created", "Environment created", { core_id: core.id, port });
    await this.store.saveEnvironment(env);

    if (input.start) {
      return this.start(id);
    }
    return env;
  }

  async list(): Promise<EnvironmentMetadata[]> {
    await this.init();
    const envs = await this.store.listEnvironments();
    return Promise.all(envs.map((env) => this.refreshStatus(env)));
  }

  async get(id: string): Promise<EnvironmentMetadata> {
    await this.init();
    const env = await this.store.getEnvironment(id);
    if (!env) throw new Error(`environment not found: ${id}`);
    return this.refreshStatus(env);
  }

  async start(id: string): Promise<EnvironmentMetadata> {
    const env = await this.get(id);
    if (env.status === "running" && env.pid && isProcessAlive(env.pid)) {
      return env;
    }
    const core = await this.coreCache.get(env.core_id);
    if (!core) throw new Error(`core not found: ${env.core_id}`);
    const java = await getJavaInfo(env.java_ref ?? "system");
    if (!java.valid) throw new Error(java.error ?? "selected Java is not valid");

    await ensureDir(env.server_dir);
    const command = await buildLaunchCommand(env, core.file_path, core.kind, core.launch?.install_args ?? [], this.installLogPath(env));
    const stdoutPath = this.stdoutLogPath(env);
    await ensureDir(path.dirname(stdoutPath));
    const outFd = fsSync.openSync(stdoutPath, "a");
    const errFd = fsSync.openSync(stdoutPath, "a");
    const child = spawn(command.command, command.args, {
      cwd: env.server_dir,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      env: {
        ...process.env,
        JAVA: java.command,
        CRAFT_RUNNER_ENV_ID: env.id
      }
    });
    child.unref();
    fsSync.closeSync(outFd);
    fsSync.closeSync(errFd);

    env.pid = child.pid;
    env.status = "running";
    env.updated_at = new Date().toISOString();
    env.java_command = java.command;
    addEvent(env, "started", "Environment started", { pid: child.pid, command: command.command, args: command.args });
    await this.store.saveEnvironment(env);
    return env;
  }

  async stop(id: string, timeoutMs = 15000): Promise<EnvironmentMetadata> {
    const env = await this.get(id);
    env.status = "stopping";
    addEvent(env, "stopping", "Stopping environment");
    await this.store.saveEnvironment(env);

    if (env.pid && isProcessAlive(env.pid)) {
      try {
        process.kill(env.pid, "SIGTERM");
      } catch {
        // Process exited.
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && isProcessAlive(env.pid)) {
        await sleep(250);
      }
      if (isProcessAlive(env.pid)) {
        try {
          process.kill(env.pid, "SIGKILL");
        } catch {
          // Process exited.
        }
      }
    }

    env.status = "stopped";
    env.pid = undefined;
    env.updated_at = new Date().toISOString();
    addEvent(env, "stopped", "Environment stopped");
    await this.store.saveEnvironment(env);
    return env;
  }

  async restart(id: string): Promise<EnvironmentMetadata> {
    await this.stop(id);
    return this.start(id);
  }

  async destroy(id: string, deleteFiles = true): Promise<{ id: string; deleted_files: boolean }> {
    const env = await this.get(id);
    if (env.status === "running" || env.status === "starting") {
      await this.stop(id);
    }
    await releasePort(this.store.locksDir(), env.port);
    await releasePort(this.store.locksDir(), env.rcon_port);
    await this.store.removeEnvironment(id);
    if (deleteFiles && (!env.persistent || env.base_dir)) {
      await fs.rm(path.join(env.base_dir, "envs", env.id), { recursive: true, force: true });
      return { id, deleted_files: true };
    }
    return { id, deleted_files: false };
  }

  async putFile(id: string, targetPath: string, options: { content?: string; source_path?: string; overwrite?: boolean }): Promise<{ target: string; bytes: number }> {
    const env = await this.get(id);
    const target = resolveInside(env.server_dir, targetPath);
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
    addEvent(env, "file_put", `Wrote ${targetPath}`, { bytes: stat.size });
    await this.store.saveEnvironment(env);
    return { target, bytes: stat.size };
  }

  async addPlugin(id: string, pluginPath: string, pluginName?: string): Promise<{ target: string; bytes: number }> {
    const name = pluginName ?? path.basename(pluginPath);
    if (!name.endsWith(".jar")) throw new Error("plugin target name must end with .jar");
    return this.putFile(id, path.join("plugins", name), { source_path: pluginPath, overwrite: true });
  }

  async removeFile(id: string, targetPath: string): Promise<{ removed: string }> {
    const env = await this.get(id);
    const target = resolveInside(env.server_dir, targetPath);
    await fs.rm(target, { recursive: true, force: true });
    addEvent(env, "file_removed", `Removed ${targetPath}`);
    await this.store.saveEnvironment(env);
    return { removed: targetPath };
  }

  async listFiles(id: string, relativePath = "."): Promise<string[]> {
    const env = await this.get(id);
    const root = resolveInside(env.server_dir, relativePath);
    const result: string[] = [];
    await collectFiles(root, env.server_dir, result);
    return result.sort();
  }

  async tailLog(id: string, lines = 120, file?: string): Promise<{ file: string; lines: string[] }> {
    const env = await this.get(id);
    const logFile = await this.resolveLogFile(env, file);
    const all = await readLines(logFile);
    return { file: logFile, lines: all.slice(Math.max(0, all.length - lines)) };
  }

  async readLog(id: string, options: { from_line?: number; to_line?: number; offset?: number; limit?: number; file?: string }): Promise<{ file: string; lines?: string[]; text?: string }> {
    const env = await this.get(id);
    const logFile = await this.resolveLogFile(env, options.file);
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

  async waitReady(id: string, timeoutMs = 120000): Promise<{ ready: boolean; env: EnvironmentMetadata; matched?: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const env = await this.get(id);
      const tail = await this.tailLog(id, 80).catch(() => ({ file: "", lines: [] }));
      const matched = tail.lines.find((line) => /Done \(|For help, type|Timings Reset/i.test(line));
      if (matched) return { ready: true, env, matched };
      if (env.status === "failed" || env.status === "stopped") return { ready: false, env };
      await sleep(1000);
    }
    return { ready: false, env: await this.get(id) };
  }

  async getEvents(id: string): Promise<EnvironmentEvent[]> {
    return (await this.get(id)).events;
  }

  async sendCommand(id: string, command: string): Promise<{ response: string }> {
    const env = await this.get(id);
    if (!env.rcon_port || !env.rcon_password) {
      throw new Error("RCON is not enabled for this environment");
    }
    const response = await sendRconCommand({
      host: env.host,
      port: env.rcon_port,
      password: env.rcon_password,
      command
    });
    addEvent(env, "command_sent", `Sent command: ${command}`);
    await this.store.saveEnvironment(env);
    return { response };
  }

  private async writeServerFiles(
    env: EnvironmentMetadata,
    properties: Record<string, string | number | boolean>,
    acceptEula: boolean
  ): Promise<void> {
    await fs.writeFile(path.join(env.server_dir, "eula.txt"), `eula=${acceptEula ? "true" : "false"}\n`);
    const serverProperties = {
      "server-ip": env.host,
      "server-port": env.port,
      "enable-rcon": Boolean(env.rcon_port),
      ...(env.rcon_port ? { "rcon.port": env.rcon_port, "rcon.password": env.rcon_password ?? "" } : {}),
      ...properties
    };
    const content = Object.entries(serverProperties).map(([key, value]) => `${key}=${value}`).join("\n");
    await fs.writeFile(path.join(env.server_dir, "server.properties"), `${content}\n`);
  }

  private stdoutLogPath(env: EnvironmentMetadata): string {
    return path.join(env.base_dir, "envs", env.id, "logs", "craft-runner-stdout.log");
  }

  private installLogPath(env: EnvironmentMetadata): string {
    return path.join(env.base_dir, "envs", env.id, "logs", "craft-runner-install.log");
  }

  private async resolveLogFile(env: EnvironmentMetadata, file?: string): Promise<string> {
    if (file) {
      return resolveInside(env.server_dir, file);
    }
    const latest = path.join(env.server_dir, "logs", "latest.log");
    if (await pathExists(latest)) return latest;
    return this.stdoutLogPath(env);
  }

  private async refreshStatus(env: EnvironmentMetadata): Promise<EnvironmentMetadata> {
    if (env.pid && env.status === "running" && !isProcessAlive(env.pid)) {
      env.status = "stopped";
      env.pid = undefined;
      env.updated_at = new Date().toISOString();
      addEvent(env, "process_exit_detected", "Tracked process is no longer running");
      await this.store.saveEnvironment(env);
    }
    return env;
  }
}

async function buildLaunchCommand(
  env: EnvironmentMetadata,
  corePath: string,
  kind: "jar" | "installer",
  installArgs: string[],
  installLogPath: string
): Promise<{ command: string; args: string[] }> {
  const java = await resolveJavaCommand(env.java_ref ?? "system");
  if (kind === "installer") {
    const marker = path.join(env.server_dir, `.craft-runner-installed-${env.core_id}`);
    if (!(await pathExists(marker))) {
      await execInstaller(java, corePath, installArgs, env.server_dir, installLogPath);
      await fs.writeFile(marker, new Date().toISOString());
    }
    const runSh = path.join(env.server_dir, "run.sh");
    if (await pathExists(runSh)) {
      return { command: "sh", args: [runSh, "nogui"] };
    }
    const jar = await findFirstJar(env.server_dir, ["forge-", "neoforge-"]);
    if (jar) {
      return { command: java, args: memoryArgs(env).concat(["-jar", jar, "nogui"]) };
    }
    throw new Error("installer core did not produce a recognizable launch file");
  }
  return { command: java, args: memoryArgs(env).concat(env.java_args, ["-jar", corePath, "nogui"]) };
}

async function execInstaller(java: string, installer: string, args: string[], cwd: string, logPath: string): Promise<void> {
  await ensureDir(path.dirname(logPath));
  const outFd = fsSync.openSync(logPath, "a");
  const errFd = fsSync.openSync(logPath, "a");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(java, ["-jar", installer, ...args], { cwd, stdio: ["ignore", outFd, errFd] });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`installer exited with code ${code}`)));
  });
  fsSync.closeSync(outFd);
  fsSync.closeSync(errFd);
}

function memoryArgs(env: EnvironmentMetadata): string[] {
  return [`-Xms${env.memory.xms}`, `-Xmx${env.memory.xmx}`];
}

function addEvent(env: EnvironmentMetadata, type: string, message: string, data?: Record<string, unknown>): void {
  env.events.push({ at: new Date().toISOString(), type, message, data });
  env.updated_at = new Date().toISOString();
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

async function readLines(file: string): Promise<string[]> {
  try {
    return (await fs.readFile(file, "utf8")).split(/\r?\n/);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function findFirstJar(dir: string, prefixes: string[]): Promise<string | undefined> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jar") && prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      return full;
    }
    if (entry.isDirectory() && entry.name !== "libraries") {
      const found = await findFirstJar(full, prefixes);
      if (found) return found;
    }
  }
  return undefined;
}
