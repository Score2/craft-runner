#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../env/manager.js";
import { getJavaInfo, listJavaInstallations, validateJavaForMinecraft } from "../java/discovery.js";
import { CORE_PROVIDERS, resolveCore, searchCores } from "../core/providers.js";
import { getAgentJar } from "../debug/agentJar.js";

const manager = new EnvironmentManager();
const rawArgs = process.argv.slice(2);
const jsonOutput = rawArgs.includes("--json");
const cliArgs = rawArgs.filter((arg) => arg !== "--json");
const [domain, action, ...rest] = cliArgs;

try {
  const result = await run(domain, action, rest);
  if (result !== undefined) {
    if (jsonOutput && typeof result !== "string") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(domain, action, result));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function run(domain: string | undefined, action: string | undefined, args: string[]): Promise<unknown> {
  const commandDomain = domain === "server" ? "env" : domain;
  if (!domain || domain === "--help" || domain === "-h" || domain === "help") return usage();
  if (commandDomain === "completion" && action === "zsh") return zshCompletion();
  if (commandDomain === "completion" && action === "install") return installCompletion(required(args[0], "shell"), args.slice(1));
  if (commandDomain === "debug" && action === "install-agent") {
    return manager.installDebugAgent(required(args[0], "server id"), await getAgentJar({ rebuild: args.includes("--rebuild") }));
  }
  if (commandDomain === "debug" && action === "status") return manager.debugAgentStatus(required(args[0], "server id"));
  if (commandDomain === "debug" && action === "js") {
    const code = valueAfter(args, "--code") ?? (valueAfter(args, "--file") ? await fs.readFile(required(valueAfter(args, "--file"), "js file"), "utf8") : undefined);
    return manager.debugEvalJs({
      env_id: required(args[0], "server id"),
      code: required(code, "js code"),
      thread: (valueAfter(args, "--thread") as "main" | "async" | undefined) ?? "main",
      timeout_ms: numberAfter(args, "--timeout-ms")
    });
  }
  if (commandDomain === "java" && action === "list") {
    const installations = await listJavaInstallations();
    if (args.includes("--refs")) {
      return installations.map((java) => java.ref).filter(Boolean).join("\n");
    }
    return installations;
  }
  if (commandDomain === "java" && action === "info") return getJavaInfo(args[0] ?? "system");
  if (commandDomain === "java" && action === "validate") {
    return validateJavaForMinecraft(valueAfter(args, "--java") ?? args[1], required(args[0], "minecraft version"));
  }
  if (commandDomain === "env" && action === "create") {
    return manager.create({
      id: valueAfter(args, "--id"),
      base_dir: valueAfter(args, "--base-dir"),
      persistent: args.includes("--persistent"),
      java_ref: valueAfter(args, "--java"),
      java_args: valuesAfter(args, "--java-arg"),
      memory: {
        xms: valueAfter(args, "--xms"),
        xmx: valueAfter(args, "--xmx")
      },
      host: valueAfter(args, "--host"),
      port: numberAfter(args, "--port"),
      accept_eula: !args.includes("--no-eula"),
      start: args.includes("--start"),
      rcon: args.includes("--rcon")
        ? {
          enabled: true,
          port: numberAfter(args, "--rcon-port"),
          password: valueAfter(args, "--rcon-password")
        }
        : undefined,
      core_ref: {
        core_id: valueAfter(args, "--core-id"),
        loader: valueAfter(args, "--loader") ?? (valueAfter(args, "--path") || valueAfter(args, "--url") ? "custom" : undefined),
        minecraft_version: valueAfter(args, "--minecraft-version") ?? valueAfter(args, "--mc"),
        build: valueAfter(args, "--build"),
        path: valueAfter(args, "--path"),
        url: valueAfter(args, "--url")
      }
    });
  }
  if (commandDomain === "env" && action === "list") {
    const envs = await manager.list();
    if (args.includes("--ids")) {
      return envs.map((env) => env.id).join("\n");
    }
    return envs;
  }
  if (commandDomain === "env" && (action === "info" || action === "get")) return manager.get(required(args[0], "server id"));
  if (commandDomain === "env" && action === "start") return manager.start(required(args[0], "server id"));
  if (commandDomain === "env" && action === "stop") return manager.stop(required(args[0], "server id"));
  if (commandDomain === "env" && action === "restart") return manager.restart(required(args[0], "server id"));
  if (commandDomain === "env" && action === "destroy") return manager.destroy(required(args[0], "server id"));
  if (commandDomain === "env" && action === "logs") {
    const envId = required(args[0], "server id");
    const fromLine = numberAfter(args, "--from-line");
    const toLine = numberAfter(args, "--to-line");
    const offset = numberAfter(args, "--offset");
    const limit = numberAfter(args, "--limit");
    const file = valueAfter(args, "--file");
    if (fromLine !== undefined || toLine !== undefined || offset !== undefined || limit !== undefined) {
      return manager.readLog(envId, { from_line: fromLine, to_line: toLine, offset, limit, file });
    }
    return manager.tailLog(envId, numberAfter(args, "--tail") ?? 120, file);
  }
  if (commandDomain === "env" && action === "files") return manager.listFiles(required(args[0], "server id"), args[1]);
  if (commandDomain === "env" && action === "put") {
    return manager.putFile(required(args[0], "server id"), required(args[1], "target path"), {
      content: valueAfter(args, "--content"),
      source_path: valueAfter(args, "--source"),
      overwrite: args.includes("--overwrite")
    });
  }
  if (commandDomain === "env" && action === "add-plugin") {
    return manager.addPlugin(required(args[0], "server id"), required(args[1], "plugin path"), valueAfter(args, "--name"));
  }
  if (commandDomain === "env" && action === "remove-file") {
    return manager.removeFile(required(args[0], "server id"), required(args[1], "target path"));
  }
  if (commandDomain === "env" && action === "events") return manager.getEvents(required(args[0], "server id"));
  if (commandDomain === "env" && action === "wait-ready") {
    return manager.waitReady(required(args[0], "server id"), numberAfter(args, "--timeout-ms"));
  }
  if (commandDomain === "env" && action === "command") {
    return manager.sendCommand(required(args[0], "server id"), required(args[1], "command"));
  }
  if (commandDomain === "core" && action === "list") {
    const cores = await manager.coreCache.list();
    if (args.includes("--ids")) {
      return cores.map((core) => core.id).join("\n");
    }
    return cores;
  }
  if (commandDomain === "core" && (action === "info" || action === "get")) return manager.coreCache.get(required(args[0], "core id"));
  if (commandDomain === "core" && action === "providers") return CORE_PROVIDERS;
  if (commandDomain === "core" && action === "search") {
    return searchCores({
      loader: args[0],
      minecraft_version: args[1],
      build: args[2]
    }, manager.coreCache);
  }
  if (commandDomain === "core" && action === "download") {
    const [loader, minecraft_version, build] = args;
    return resolveCore({ loader, minecraft_version, build: build ?? "latest" }, manager.coreCache);
  }
  if (commandDomain === "core" && action === "import") {
    return resolveCore({
      loader: valueAfter(args, "--loader") ?? "custom",
      minecraft_version: valueAfter(args, "--minecraft-version") ?? valueAfter(args, "--mc") ?? "unknown",
      path: valueAfter(args, "--path"),
      url: valueAfter(args, "--url")
    }, manager.coreCache);
  }
  if (commandDomain === "core" && action === "verify") return manager.coreCache.verify(required(args[0], "core id"));
  if (commandDomain === "core" && (action === "remove" || action === "delete")) return manager.coreCache.remove(required(args[0], "core id"));
  return usage();
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function usage(): string {
  return [
    "Usage:",
    "  craft-runner [--json] <command>",
    "  craft-runner java list",
    "  craft-runner java info [ref]",
    "  craft-runner java validate <minecraft-version> [--java <ref>]",
    "  craft-runner core list",
    "  craft-runner core info <id>",
    "  craft-runner core providers",
    "  craft-runner core search [loader] [minecraft-version]",
    "  craft-runner core download <loader> <minecraft-version> [build]",
    "  craft-runner core import --path <jar> [--minecraft-version <version>]",
    "  craft-runner core import --url <https-url> [--minecraft-version <version>]",
    "  craft-runner core verify <id>",
    "  craft-runner core remove <id>",
    "  craft-runner server create --id <id> --core-id <core-id> [--start]",
    "  craft-runner server create --id <id> --loader <loader> --minecraft-version <version> [--build <build>]",
    "  craft-runner server create --id <id> --path <server.jar> --minecraft-version <version>",
    "  craft-runner server list",
    "  craft-runner server info <id>",
    "  craft-runner server start <id>",
    "  craft-runner server stop <id>",
    "  craft-runner server restart <id>",
    "  craft-runner server destroy <id>",
    "  craft-runner server logs <id> [--tail <n>]",
    "  craft-runner server files <id> [path]",
    "  craft-runner server put <id> <target> (--content <text>|--source <path>) [--overwrite]",
    "  craft-runner server add-plugin <id> <jar> [--name <file.jar>]",
    "  craft-runner server remove-file <id> <target>",
    "  craft-runner server events <id>",
    "  craft-runner server wait-ready <id> [--timeout-ms <ms>]",
    "  craft-runner server command <id> <command>",
    "  craft-runner debug install-agent <server-id> [--rebuild]",
    "  craft-runner debug status <server-id>",
    "  craft-runner debug js <server-id> (--code <js>|--file <file.js>) [--thread main|async]",
    "  craft-runner env ...    (alias for server)",
    "  craft-runner completion zsh",
    "  craft-runner completion install zsh [--dir <dir>]"
  ].join("\n");
}

async function installCompletion(shell: string, args: string[]): Promise<unknown> {
  if (shell !== "zsh") {
    throw new Error("only zsh completion installation is currently supported");
  }
  const explicitDir = valueAfter(args, "--dir");
  const dir = explicitDir ?? await findZshCompletionDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "_craft-runner");
  const aliasTarget = path.join(dir, "_craftr");
  await fs.writeFile(target, zshCompletion(), "utf8");
  await fs.writeFile(aliasTarget, zshCompletion(), "utf8");
  return {
    shell: "zsh",
    installed: [target, aliasTarget],
    note: "Open a new zsh session or run `autoload -Uz compinit && compinit` if completion was already initialized."
  };
}

async function findZshCompletionDir(): Promise<string> {
  const candidates = [
    process.env.CRAFT_RUNNER_ZSH_COMPLETION_DIR,
    "/opt/homebrew/share/zsh/site-functions",
    "/usr/local/share/zsh/site-functions",
    path.join(os.homedir(), ".oh-my-zsh", "completions"),
    path.join(os.homedir(), ".zsh", "completions")
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await isWritableDirectory(candidate)) {
      return candidate;
    }
  }
  return path.join(os.homedir(), ".zsh", "completions");
}

async function isWritableDirectory(dir: string): Promise<boolean> {
  try {
    await fs.access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function numberAfter(args: string[], flag: string): number | undefined {
  const value = valueAfter(args, flag);
  return value === undefined ? undefined : Number(value);
}

function formatResult(domain: string | undefined, action: string | undefined, result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "";

  if (domain === "completion" && action === "install" && isRecord(result)) {
    const installed = Array.isArray(result.installed) ? result.installed : [result.installed];
    return [
      `Installed ${result.shell ?? "shell"} completion:`,
      ...installed.filter(Boolean).map((file) => `  ${file}`),
      "",
      String(result.note ?? "")
    ].join("\n").trimEnd();
  }

  if (domain === "java" && action === "list" && Array.isArray(result)) {
    return result.length === 0 ? "No Java installations found." : table(
      ["REF", "VER", "SOURCE", "COMMAND"],
      result.map((java) => [
        stringValue(java.ref),
        stringValue(java.version ?? "?"),
        stringValue(java.source),
        stringValue(java.command)
      ])
    );
  }

  if (domain === "java" && action === "info" && isRecord(result)) {
    return details("Java", [
      ["Ref", result.ref],
      ["Command", result.command],
      ["Version", result.version_string ?? result.version],
      ["Source", result.source],
      ["Valid", result.valid ? "yes" : "no"],
      ["Error", result.error]
    ]);
  }

  if (domain === "java" && action === "validate" && isRecord(result)) {
    const java = isRecord(result.java) ? result.java : {};
    return [
      result.ok ? "Java is compatible." : "Java is not compatible.",
      details(undefined, [
        ["Minecraft requires", `Java ${result.required}+`],
        ["Selected Java", java.version ? `Java ${java.version}` : java.command],
        ["Command", java.command],
        ["Message", result.message]
      ])
    ].join("\n");
  }

  if (domain === "core" && action === "list" && Array.isArray(result)) {
    return result.length === 0 ? "No cached cores found." : table(
      ["ID", "LOADER", "MC", "BUILD", "SIZE"],
      result.map((core) => [
        stringValue(core.id),
        stringValue(core.loader),
        stringValue(core.minecraft_version),
        stringValue(core.build ?? "-"),
        formatBytes(Number(core.size ?? 0))
      ])
    );
  }

  if (domain === "core" && (action === "info" || action === "get" || action === "download" || action === "import") && isRecord(result)) {
    return formatCore(result);
  }

  if (domain === "core" && action === "providers" && Array.isArray(result)) {
    return table(
      ["ID", "LOADERS", "STATUS", "NOTES"],
      result.map((provider) => [
        stringValue(provider.id),
        Array.isArray(provider.loaders) ? provider.loaders.join(",") : "",
        stringValue(provider.status),
        stringValue(provider.notes)
      ])
    );
  }

  if (domain === "core" && action === "verify" && isRecord(result)) {
    return result.ok
      ? `Core verified: ${stringValue(isRecord(result.core) ? result.core.id : "")}`
      : `Core verification failed${isRecord(result.core) ? `: ${result.core.id}` : ""}`;
  }

  if (domain === "core" && (action === "remove" || action === "delete")) {
    return result ? "Core removed." : "Core not found.";
  }

  if ((domain === "env" || domain === "server") && action === "list" && Array.isArray(result)) {
    return result.length === 0 ? "No environments found." : table(
      ["ID", "STATUS", "LOADER", "MC", "PORT", "PID"],
      result.map((env) => [
        stringValue(env.id),
        stringValue(env.status),
        stringValue(env.loader),
        stringValue(env.minecraft_version),
        stringValue(env.port),
        stringValue(env.pid ?? "-")
      ])
    );
  }

  if ((domain === "env" || domain === "server") && ["create", "info", "get", "start", "stop", "restart"].includes(action ?? "") && isRecord(result)) {
    return formatEnvironment(result);
  }

  if ((domain === "env" || domain === "server") && action === "destroy" && isRecord(result)) {
    return `Server destroyed: ${result.id}\nDeleted files: ${result.deleted_files ? "yes" : "no"}`;
  }

  if ((domain === "env" || domain === "server") && action === "logs" && isRecord(result)) {
    const lines = Array.isArray(result.lines) ? result.lines : undefined;
    return [
      `Log: ${result.file}`,
      lines ? lines.join("\n") : stringValue(result.text)
    ].join("\n");
  }

  if ((domain === "env" || domain === "server") && action === "files" && Array.isArray(result)) {
    return result.length === 0 ? "No files found." : result.join("\n");
  }

  if ((domain === "env" || domain === "server") && ["put", "add-plugin"].includes(action ?? "") && isRecord(result)) {
    return `Wrote ${result.bytes} bytes to ${result.target}`;
  }

  if ((domain === "env" || domain === "server") && action === "remove-file" && isRecord(result)) {
    return `Removed ${result.removed}`;
  }

  if ((domain === "env" || domain === "server") && action === "events" && Array.isArray(result)) {
    return result.length === 0 ? "No events found." : table(
      ["AT", "TYPE", "MESSAGE"],
      result.map((event) => [stringValue(event.at), stringValue(event.type), stringValue(event.message)])
    );
  }

  if ((domain === "env" || domain === "server") && action === "wait-ready" && isRecord(result)) {
    return result.ready
      ? `Environment is ready.${result.matched ? `\nMatched: ${result.matched}` : ""}`
      : "Environment was not ready before timeout.";
  }

  if ((domain === "env" || domain === "server") && action === "command" && isRecord(result)) {
    return stringValue(result.response);
  }

  if (domain === "debug" && action === "install-agent" && isRecord(result)) {
    return [
      "Debug agent installed.",
      formatEnvironment(result),
      "",
      "Restart or start the server so the platform loads craft-runner-agent.jar."
    ].join("\n");
  }

  if (domain === "debug" && action === "status" && isRecord(result)) {
    return details("Debug agent", [
      ["Server", result.env_id],
      ["Configured", result.configured ? "yes" : "no"],
      ["Agent jar", result.agent_jar],
      ["Agent jar exists", result.agent_jar_exists ? "yes" : "no"],
      ["All agent jars", Array.isArray(result.agent_jars) ? result.agent_jars.join(", ") : undefined],
      ["Mailbox", result.mailbox_dir],
      ["Mailbox exists", result.mailbox_exists ? "yes" : "no"],
      ["Requests dir", result.requests_dir_exists ? "yes" : "no"],
      ["Responses dir", result.responses_dir_exists ? "yes" : "no"],
      ["Installed at", result.installed_at]
    ]);
  }

  if (domain === "debug" && action === "js" && isRecord(result)) {
    if (result.ok) {
      const value = isRecord(result.result) ? result.result.value : result.result;
      const type = isRecord(result.result) ? result.result.type : typeof value;
      return details("Debug result", [
        ["OK", "yes"],
        ["Type", type],
        ["Value", value],
        ["Duration", `${result.durationMs ?? result.duration_ms ?? "?"} ms`]
      ]);
    }
    return details("Debug error", [
      ["OK", "no"],
      ["Error", result.error],
      ["Stack", result.stack]
    ]);
  }

  if (Array.isArray(result)) {
    if (result.length === 0) return "No results.";
    if (result.every(isRecord)) return objectTable(result);
  }
  if (isRecord(result)) return details(undefined, Object.entries(result));
  return String(result);
}

function formatCore(core: Record<string, unknown>): string {
  return details("Core", [
    ["ID", core.id],
    ["Loader", core.loader],
    ["Minecraft", core.minecraft_version],
    ["Build", core.build],
    ["Provider", core.provider],
    ["Kind", core.kind],
    ["Size", typeof core.size === "number" ? formatBytes(core.size) : core.size],
    ["SHA256", core.sha256],
    ["File", core.file_path],
    ["Source", core.source]
  ]);
}

function formatEnvironment(env: Record<string, unknown>): string {
  return details("Server", [
    ["ID", env.id],
    ["Status", env.status],
    ["Loader", env.loader],
    ["Minecraft", env.minecraft_version],
    ["Core", env.core_id],
    ["Address", `${env.host ?? "127.0.0.1"}:${env.port ?? "?"}`],
    ["RCON", env.rcon_port ? `${env.host ?? "127.0.0.1"}:${env.rcon_port}` : "disabled"],
    ["PID", env.pid],
    ["Java", env.java_command ?? env.java_ref],
    ["Server dir", env.server_dir]
  ]);
}

function details(title: string | undefined, rows: Array<[string, unknown]>): string {
  const filtered = rows.filter(([, value]) => value !== undefined && value !== "");
  const width = filtered.reduce((max, [key]) => Math.max(max, key.length), 0);
  const body = filtered.map(([key, value]) => `${key.padEnd(width)}  ${stringValue(value)}`).join("\n");
  return title ? `${title}\n${body}` : body;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const render = (row: string[]) => row.map((cell, index) => (cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  return [render(headers), render(widths.map((width) => "-".repeat(width))), ...rows.map(render)].join("\n");
}

function objectTable(rows: Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 6);
  return table(headers.map((header) => header.toUpperCase()), rows.map((row) => headers.map((header) => stringValue(row[header]))));
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function zshCompletion(): string {
  return `#compdef craft-runner craftr

_craft_runner_env_ids() {
  local -a ids
  ids=("\${(@f)$($words[1] env list --ids 2>/dev/null)}")
  _describe 'environment id' ids
}

_craft_runner_core_ids() {
  local -a ids
  ids=("\${(@f)$($words[1] core list --ids 2>/dev/null)}")
  _describe 'core id' ids
}

_craft_runner_java_refs() {
  local -a refs
  refs=("\${(@f)$($words[1] java list --refs 2>/dev/null)}")
  _describe 'java ref' refs
}

_craft_runner() {
  local -a commands java_commands core_commands env_commands debug_commands completion_commands loaders
  commands=(
    'java:discover and inspect Java installations'
    'core:manage cached Minecraft server cores'
    'server:manage local Minecraft test servers'
    'env:alias for server'
    'debug:execute JS through the file mailbox agent'
    'completion:generate shell completion scripts'
    'help:show command help'
  )
  java_commands=(
    'list:list Java installations'
    'info:inspect a Java reference'
    'validate:validate Java compatibility'
  )
  core_commands=(
    'list:list cached cores'
    'info:show cached core metadata'
    'providers:list core providers'
    'search:search provider versions or builds'
    'download:download or prepare a core'
    'import:import a local jar or HTTPS URL'
    'verify:verify cached core checksum'
    'remove:remove a cached core'
    'delete:remove a cached core'
  )
  env_commands=(
    'create:create a test server'
    'list:list environments'
    'info:show environment metadata'
    'start:start an environment'
    'stop:stop an environment'
    'restart:restart an environment'
    'destroy:destroy an environment'
    'logs:read environment logs'
    'files:list environment files'
    'put:write or copy a file into an environment'
    'add-plugin:add a plugin jar'
    'remove-file:remove a file from an environment'
    'events:show lifecycle events'
    'wait-ready:wait for server readiness'
    'command:send a server command through RCON'
  )
  debug_commands=(
    'install-agent:install JS debug agent'
    'status:show debug agent status'
    'js:execute JavaScript through the debug agent'
  )
  completion_commands=('zsh:generate zsh completion script')
  loaders=(custom vanilla paper purpur folia fabric forge neoforge spigot craftbukkit)

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "$words[2]" in
    java)
      if (( CURRENT == 3 )); then
        _describe 'java command' java_commands
        return
      fi
      if [[ "$words[3]" == "info" ]]; then
        _craft_runner_java_refs
        return
      fi
      if [[ "$words[3]" == "validate" && "$CURRENT" -gt 4 ]]; then
        _arguments '--java[Java reference]:java ref:_craft_runner_java_refs'
        return
      fi
      ;;
    core)
      if (( CURRENT == 3 )); then
        _describe 'core command' core_commands
        return
      fi
      case "$words[3]" in
        download|search)
          if (( CURRENT == 4 )); then
            _describe 'loader' loaders
            return
          fi
          ;;
        info|verify|remove|delete)
          _craft_runner_core_ids
          return
          ;;
        import)
          _arguments '--path[local jar path]:jar:_files -g "*.jar"' '--url[HTTPS URL]' '--minecraft-version[Minecraft version]' '--mc[Minecraft version]' '--loader[loader]:loader:->loaders'
          return
          ;;
        list)
          _arguments '--ids[print only core ids]'
          return
          ;;
      esac
      ;;
    env|server)
      if (( CURRENT == 3 )); then
        _describe 'environment command' env_commands
        return
      fi
      case "$words[3]" in
        create)
          _arguments \
            '--id[server id]' \
            '--core-id[cached core id]:core id:_craft_runner_core_ids' \
            '--loader[server loader]:loader:->loaders' \
            '--minecraft-version[Minecraft version]' \
            '--mc[Minecraft version]' \
            '--build[core build]' \
            '--path[custom server jar]:jar:_files -g "*.jar"' \
            '--url[custom HTTPS server jar URL]' \
            '--start[start after creation]' \
            '--base-dir[base directory]:directory:_files -/' \
            '--persistent[persist server directory]' \
            '--java[Java reference]:java ref:_craft_runner_java_refs' \
            '--xms[minimum heap]' \
            '--xmx[maximum heap]' \
            '--host[bind host]' \
            '--port[server port]' \
            '--rcon[enable RCON]' \
            '--rcon-port[RCON port]' \
            '--rcon-password[RCON password]' \
            '--no-eula[write eula=false]'
          return
          ;;
        info|start|stop|restart|destroy|events|wait-ready|command)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          ;;
        logs)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          _arguments '--tail[tail line count]' '--from-line[start line]' '--to-line[end line]' '--offset[byte offset]' '--limit[byte limit]' '--file[log file path]'
          return
          ;;
        files|remove-file)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          ;;
        put)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          _arguments '--content[file content]' '--source[source path]:path:_files' '--overwrite[overwrite existing target]'
          return
          ;;
        add-plugin)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          _arguments '--name[target plugin jar name]' '*:jar:_files -g "*.jar"'
          return
          ;;
        list)
          _arguments '--ids[print only environment ids]'
          return
          ;;
      esac
      ;;
    debug)
      if (( CURRENT == 3 )); then
        _describe 'debug command' debug_commands
        return
      fi
      case "$words[3]" in
        install-agent|status)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          ;;
        js)
          if (( CURRENT == 4 )); then
            _craft_runner_env_ids
            return
          fi
          _arguments '--code[JavaScript code]' '--file[JavaScript file]:file:_files -g "*.js"' '--thread[execution thread]:thread:(main async)' '--timeout-ms[timeout milliseconds]'
          return
          ;;
      esac
      ;;
    completion)
      if (( CURRENT == 3 )); then
        _describe 'shell' completion_commands
        return
      fi
      ;;
  esac
}

_craft_runner "$@"
`;
}
