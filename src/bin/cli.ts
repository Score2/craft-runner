#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../env/manager.js";
import { getJavaInfo, listJavaInstallations } from "../java/discovery.js";
import { resolveCore } from "../core/providers.js";

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
  if (domain === "env" && action === "list") {
    const envs = await manager.list();
    if (args.includes("--ids")) {
      return envs.map((env) => env.id).join("\n");
    }
    return envs;
  }
  if (domain === "env" && action === "start") return manager.start(required(args[0], "env id"));
  if (domain === "env" && action === "stop") return manager.stop(required(args[0], "env id"));
  if (domain === "env" && action === "destroy") return manager.destroy(required(args[0], "env id"));
  if (domain === "core" && action === "list") {
    const cores = await manager.coreCache.list();
    if (args.includes("--ids")) {
      return cores.map((core) => core.id).join("\n");
    }
    return cores;
  }
  if (domain === "core" && action === "download") {
    const [loader, minecraft_version, build] = args;
    return resolveCore({ loader, minecraft_version, build: build ?? "latest" }, manager.coreCache);
  }
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
    "  craft-runner core list",
    "  craft-runner core download <loader> <minecraft-version> [build]",
    "  craft-runner env list",
    "  craft-runner env start <id>",
    "  craft-runner env stop <id>",
    "  craft-runner env destroy <id>",
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
  await fs.writeFile(target, zshCompletion(), "utf8");
  return {
    shell: "zsh",
    installed: target,
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

function zshCompletion(): string {
  return `#compdef craft-runner

_craft_runner_env_ids() {
  local -a ids
  ids=("\${(@f)$(craft-runner env list --ids 2>/dev/null)}")
  _describe 'environment id' ids
}

_craft_runner_core_ids() {
  local -a ids
  ids=("\${(@f)$(craft-runner core list --ids 2>/dev/null)}")
  _describe 'core id' ids
}

_craft_runner_java_refs() {
  local -a refs
  refs=("\${(@f)$(craft-runner java list --refs 2>/dev/null)}")
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
  )
  core_commands=(
    'list:list cached cores'
    'download:download or prepare a core'
  )
  env_commands=(
    'list:list environments'
    'start:start an environment'
    'stop:stop an environment'
    'destroy:destroy an environment'
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
      ;;
    core)
      if (( CURRENT == 3 )); then
        _describe 'core command' core_commands
        return
      fi
      case "$words[3]" in
        download)
          if (( CURRENT == 4 )); then
            _describe 'loader' loaders
            return
          fi
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
        start|stop|destroy)
          _craft_runner_env_ids
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
