import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { CraftRunnerConfig } from "./types.js";

function rootDir(): string {
  if (process.env.CRAFT_RUNNER_HOME) {
    return process.env.CRAFT_RUNNER_HOME;
  }
  return path.join(os.homedir(), ".craft-runner");
}

function legacyCacheDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "craft-runner");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "craft-runner", "Cache");
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "craft-runner");
}

export function loadConfig(): CraftRunnerConfig {
  const root = rootDir();
  const cacheDir = process.env.CRAFT_RUNNER_CACHE_DIR ?? path.join(root, "cache");
  const stateDir = process.env.CRAFT_RUNNER_STATE_DIR ?? path.join(root, "state");
  if (!process.env.CRAFT_RUNNER_CACHE_DIR) {
    migrateLegacyDirectory(legacyCacheDir(), cacheDir);
    removeDirectoryQuietly(path.join(cacheDir, "state"));
  }
  if (!process.env.CRAFT_RUNNER_STATE_DIR) {
    migrateLegacyDirectory(path.join(legacyCacheDir(), "state"), stateDir);
  }
  const serverBaseDir =
    process.env.CRAFT_RUNNER_SERVER_BASE_DIR ?? path.join(os.tmpdir(), "craft-runner");

  return {
    root_dir: root,
    cache_dir: cacheDir,
    agents_dir: process.env.CRAFT_RUNNER_AGENTS_DIR ?? path.join(root, "agents"),
    server_base_dir: serverBaseDir,
    state_dir: stateDir,
    user_agent:
      process.env.CRAFT_RUNNER_USER_AGENT ??
      "craft-runner/1.0.2 (https://github.com/Score2/craft-runner)",
    ports: {
      minecraft_start: Number(process.env.CRAFT_RUNNER_MC_PORT_START ?? 40000),
      minecraft_end: Number(process.env.CRAFT_RUNNER_MC_PORT_END ?? 49999),
      rcon_start: Number(process.env.CRAFT_RUNNER_RCON_PORT_START ?? 50000),
      rcon_end: Number(process.env.CRAFT_RUNNER_RCON_PORT_END ?? 54999)
    },
    java: {
      default_ref: process.env.CRAFT_RUNNER_JAVA_REF ?? "system",
      default_xms: process.env.CRAFT_RUNNER_XMS ?? "1G",
      default_xmx: process.env.CRAFT_RUNNER_XMX ?? "2G",
      prefer_sdkman: process.env.CRAFT_RUNNER_PREFER_SDKMAN !== "false"
    }
  };
}

function migrateLegacyDirectory(source: string, target: string): void {
  if (source === target || process.env.CRAFT_RUNNER_DISABLE_MIGRATION === "true") {
    return;
  }
  try {
    if (!fs.existsSync(source) || fs.existsSync(target)) {
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
  } catch {
    // Migration is best-effort; missing permissions must not prevent startup.
  }
}

function removeDirectoryQuietly(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort for the same reason as migration.
  }
}
