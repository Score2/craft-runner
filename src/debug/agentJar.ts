import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists } from "../lib/fsx.js";

export async function getAgentJar(options: { rebuild?: boolean; loader?: string; minecraft_version?: string } = {}): Promise<string> {
  const root = projectRoot();
  const agentDir = path.join(root, "agent");
  const jar = path.join(agentDir, "build", "libs", `${agentJarName(options.loader, options.minecraft_version)}.jar`);
  if (options.rebuild || !(await pathExists(jar))) {
    await runGradle(agentDir);
  }
  await fs.access(jar);
  return jar;
}

export function agentJarName(loader = "custom", minecraftVersion = "unknown"): string {
  const normalized = loader.toLowerCase();
  if (["bukkit", "craftbukkit", "spigot", "paper", "purpur", "folia"].includes(normalized)) {
    return "craft-runner-agent-bukkit";
  }
  if (["bungee", "bungeecord", "waterfall"].includes(normalized)) {
    return "craft-runner-agent-bungee";
  }
  if (normalized === "velocity") {
    return "craft-runner-agent-velocity";
  }
  if (normalized === "fabric") {
    return "craft-runner-agent-fabric";
  }
  if (normalized === "forge") {
    return `craft-runner-agent-forge-${isJava21Minecraft(minecraftVersion) ? "modern" : "legacy"}`;
  }
  if (normalized === "neoforge") {
    return `craft-runner-agent-neoforge-${isJava21Minecraft(minecraftVersion) ? "modern" : "legacy"}`;
  }
  return "craft-runner-agent-bukkit";
}

function isJava21Minecraft(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return false;
  }
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  return minor > 20 || (minor === 20 && patch >= 5);
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function runGradle(agentDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = ["-p", agentDir, "jar"];
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "gradle.cmd", ...args], {
        cwd: path.dirname(agentDir),
        stdio: ["ignore", "pipe", "pipe"]
      })
      : spawn("gradle", args, {
        cwd: path.dirname(agentDir),
        stdio: ["ignore", "pipe", "pipe"]
      });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString("utf8")}`.slice(-20000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gradle exited with code ${code}${output ? `\n${output.trimEnd()}` : ""}`));
      }
    });
  });
}
