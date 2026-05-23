import os from "node:os";
import path from "node:path";
import { CraftRunnerConfig } from "./types.js";

function userCacheDir(): string {
  if (process.env.CRAFT_RUNNER_CACHE_DIR) {
    return process.env.CRAFT_RUNNER_CACHE_DIR;
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "craft-runner");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "craft-runner", "Cache");
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "craft-runner");
}

export function loadConfig(): CraftRunnerConfig {
  const cacheDir = userCacheDir();
  const serverBaseDir =
    process.env.CRAFT_RUNNER_SERVER_BASE_DIR ?? path.join(os.tmpdir(), "craft-runner");

  return {
    cache_dir: cacheDir,
    server_base_dir: serverBaseDir,
    state_dir: process.env.CRAFT_RUNNER_STATE_DIR ?? path.join(cacheDir, "state"),
    user_agent:
      process.env.CRAFT_RUNNER_USER_AGENT ??
      "craft-runner/0.1.0 (https://github.com/Score2/craft-runner)",
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
