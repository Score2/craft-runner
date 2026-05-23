import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists } from "../lib/fsx.js";

export async function getAgentJar(options: { rebuild?: boolean } = {}): Promise<string> {
  const root = projectRoot();
  const agentDir = path.join(root, "agent");
  const jar = path.join(agentDir, "build", "libs", "craft-runner-agent-0.1.0.jar");
  if (options.rebuild || !(await pathExists(jar))) {
    await runGradle(agentDir);
  }
  await fs.access(jar);
  return jar;
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function runGradle(agentDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("gradle", ["-p", agentDir, "jar"], {
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
