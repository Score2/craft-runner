#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../env/manager.js";
import { getJavaInfo, listJavaInstallations, validateJavaForMinecraft } from "../java/discovery.js";
import { CORE_PROVIDERS, resolveCore, searchCores } from "../core/providers.js";

const manager = new EnvironmentManager();
const [, , domain, action, ...rest] = process.argv;

try {
  const result = await run(domain, action, rest);
  if (result !== undefined) {
    if (typeof result === "string") {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function run(domain: string | undefined, action: string | undefined, args: string[]): Promise<unknown> {
  if (!domain || domain === "--help" || domain === "-h" || domain === "help") return usage();
  if (domain === "completion" && action === "zsh") return zshCompletion();
  if (domain === "completion" && action === "install") return installCompletion(required(args[0], "shell"), args.slice(1));
  if (domain === "java" && action === "list") {
    const installations = await listJavaInstallations();
    if (args.includes("--refs")) {
      return installations.map((java) => java.ref).filter(Boolean).join("\n");
    }
    return installations;
  }
  if (domain === "java" && action === "info") return getJavaInfo(args[0] ?? "system");
  if (domain === "java" && action === "validate") {
    return validateJavaForMinecraft(valueAfter(args, "--java") ?? args[1], required(args[0], "minecraft version"));
  }
  if (domain === "env" && action === "list") {
    const envs = await manager.list();
    if (args.includes("--ids")) {
      return envs.map((env) => env.id).join("\n");
    }
    return envs;
  }
  if (domain === "env" && (action === "info" || action === "get")) return manager.get(required(args[0], "env id"));
  if (domain === "env" && action === "start") return manager.start(required(args[0], "env id"));
  if (domain === "env" && action === "stop") return manager.stop(required(args[0], "env id"));
  if (domain === "env" && action === "restart") return manager.restart(required(args[0], "env id"));
  if (domain === "env" && action === "destroy") return manager.destroy(required(args[0], "env id"));
  if (domain === "env" && action === "logs") {
    const envId = required(args[0], "env id");
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
  if (domain === "env" && action === "files") return manager.listFiles(required(args[0], "env id"), args[1]);
  if (domain === "env" && action === "put") {
    return manager.putFile(required(args[0], "env id"), required(args[1], "target path"), {
      content: valueAfter(args, "--content"),
      source_path: valueAfter(args, "--source"),
      overwrite: args.includes("--overwrite")
    });
  }
  if (domain === "env" && action === "add-plugin") {
    return manager.addPlugin(required(args[0], "env id"), required(args[1], "plugin path"), valueAfter(args, "--name"));
  }
  if (domain === "env" && action === "remove-file") {
    return manager.removeFile(required(args[0], "env id"), required(args[1], "target path"));
  }
  if (domain === "env" && action === "events") return manager.getEvents(required(args[0], "env id"));
  if (domain === "env" && action === "wait-ready") {
    return manager.waitReady(required(args[0], "env id"), numberAfter(args, "--timeout-ms"));
  }
  if (domain === "env" && action === "command") {
    return manager.sendCommand(required(args[0], "env id"), required(args[1], "command"));
  }
  if (domain === "core" && action === "list") {
    const cores = await manager.coreCache.list();
    if (args.includes("--ids")) {
      return cores.map((core) => core.id).join("\n");
    }
    return cores;
  }
  if (domain === "core" && (action === "info" || action === "get")) return manager.coreCache.get(required(args[0], "core id"));
  if (domain === "core" && action === "providers") return CORE_PROVIDERS;
  if (domain === "core" && action === "search") {
    return searchCores({
      loader: args[0],
      minecraft_version: args[1],
      build: args[2]
    }, manager.coreCache);
  }
  if (domain === "core" && action === "download") {
    const [loader, minecraft_version, build] = args;
    return resolveCore({ loader, minecraft_version, build: build ?? "latest" }, manager.coreCache);
  }
  if (domain === "core" && action === "import") {
    return resolveCore({
      loader: valueAfter(args, "--loader") ?? "custom",
      minecraft_version: valueAfter(args, "--minecraft-version") ?? valueAfter(args, "--mc") ?? "unknown",
      path: valueAfter(args, "--path"),
      url: valueAfter(args, "--url")
    }, manager.coreCache);
  }
  if (domain === "core" && action === "verify") return manager.coreCache.verify(required(args[0], "core id"));
  if (domain === "core" && (action === "remove" || action === "delete")) return manager.coreCache.remove(required(args[0], "core id"));
  return usage();
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function usage(): string {
  return [
    "Usage:",
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
    "  craft-runner env list",
    "  craft-runner env info <id>",
    "  craft-runner env start <id>",
    "  craft-runner env stop <id>",
    "  craft-runner env restart <id>",
    "  craft-runner env destroy <id>",
    "  craft-runner env logs <id> [--tail <n>]",
    "  craft-runner env logs <id> --from-line <n> [--to-line <n>]",
    "  craft-runner env files <id> [path]",
    "  craft-runner env put <id> <target> (--content <text>|--source <path>) [--overwrite]",
    "  craft-runner env add-plugin <id> <jar> [--name <file.jar>]",
    "  craft-runner env remove-file <id> <target>",
    "  craft-runner env events <id>",
    "  craft-runner env wait-ready <id> [--timeout-ms <ms>]",
    "  craft-runner env command <id> <command>",
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

function numberAfter(args: string[], flag: string): number | undefined {
  const value = valueAfter(args, flag);
  return value === undefined ? undefined : Number(value);
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
  local -a commands java_commands core_commands env_commands completion_commands loaders
  commands=(
    'java:discover and inspect Java installations'
    'core:manage cached Minecraft server cores'
    'env:manage local test environments'
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
    env)
      if (( CURRENT == 3 )); then
        _describe 'environment command' env_commands
        return
      fi
      case "$words[3]" in
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
