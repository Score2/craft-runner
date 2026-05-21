import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JavaInfo } from "../lib/types.js";
import { pathExists } from "../lib/fsx.js";

const execFileAsync = promisify(execFile);

export async function getJavaInfo(ref = "system"): Promise<JavaInfo> {
  const command = await resolveJavaCommand(ref);
  const base: JavaInfo = {
    id: ref,
    ref,
    command,
    source: sourceForRef(ref),
    valid: false
  };

  try {
    const result = await execFileAsync(command, ["-version"], { timeout: 10000 });
    const output = `${result.stderr}\n${result.stdout}`.trim();
    const parsed = parseJavaVersion(output);
    return {
      ...base,
      id: ref === "system" ? "system" : ref,
      version: parsed.major,
      version_string: parsed.raw,
      vendor: parsed.vendor,
      valid: true
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function listJavaInstallations(): Promise<JavaInfo[]> {
  const refs = new Set<string>(["system"]);
  if (process.env.JAVA_HOME) {
    refs.add(`home:${process.env.JAVA_HOME}`);
  }

  for (const sdkVersion of await listSdkmanJavaVersions()) {
    refs.add(`sdk:${sdkVersion}`);
  }

  for (const home of await commonJavaHomes()) {
    refs.add(`home:${home}`);
  }

  const infos = await Promise.all([...refs].map((ref) => getJavaInfo(ref)));
  const seen = new Set<string>();
  return infos.filter((info) => {
    if (seen.has(info.command)) {
      return false;
    }
    seen.add(info.command);
    return true;
  });
}

export async function resolveJavaCommand(ref = "system"): Promise<string> {
  if (ref === "system" || ref === "") {
    return "java";
  }
  if (ref === "sdkman:current" || ref === "sdk:current") {
    return path.join(sdkmanDir(), "candidates", "java", "current", "bin", executable("java"));
  }
  if (ref.startsWith("sdkman:")) {
    return path.join(sdkmanDir(), "candidates", "java", ref.slice("sdkman:".length), "bin", executable("java"));
  }
  if (ref.startsWith("sdk:")) {
    return path.join(sdkmanDir(), "candidates", "java", ref.slice("sdk:".length), "bin", executable("java"));
  }
  if (ref.startsWith("path:")) {
    return ref.slice("path:".length);
  }
  if (ref.startsWith("home:")) {
    return path.join(ref.slice("home:".length), "bin", executable("java"));
  }
  if (path.isAbsolute(ref)) {
    return ref;
  }
  return ref;
}

export async function validateJavaForMinecraft(
  javaRef: string | undefined,
  minecraftVersion: string
): Promise<{ ok: boolean; required: number; java: JavaInfo; message: string }> {
  const java = await getJavaInfo(javaRef ?? "system");
  const required = requiredJavaMajor(minecraftVersion);
  if (!java.valid || !java.version) {
    return { ok: false, required, java, message: java.error ?? "Java is not executable" };
  }
  if (java.version < required) {
    return {
      ok: false,
      required,
      java,
      message: `Minecraft ${minecraftVersion} requires Java ${required}+; selected Java is ${java.version}`
    };
  }
  return { ok: true, required, java, message: "Java version is compatible" };
}

export function requiredJavaMajor(minecraftVersion: string): number {
  const match = minecraftVersion.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return 17;
  }
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (minor >= 21) {
    return 21;
  }
  if (minor === 20 && patch >= 5) {
    return 21;
  }
  if (minor >= 18) {
    return 17;
  }
  if (minor === 17) {
    return 16;
  }
  return 8;
}

function parseJavaVersion(output: string): { major: number; raw: string; vendor?: string } {
  const versionLine = output.split(/\r?\n/).find((line) => /version|openjdk/i.test(line)) ?? output;
  const quoted = versionLine.match(/version "([^"]+)"/i)?.[1] ?? versionLine.match(/openjdk\s+([0-9][^\s]*)/i)?.[1] ?? "";
  let major = 0;
  if (quoted.startsWith("1.")) {
    major = Number(quoted.split(".")[1]);
  } else {
    major = Number(quoted.split(".")[0]);
  }
  const vendor = output.match(/(?:Runtime Environment|VM)\s+\(?([^)]+)\)?/i)?.[1];
  return { major, raw: quoted || versionLine, vendor };
}

function sourceForRef(ref: string): JavaInfo["source"] {
  if (ref === "system" || ref === "") return "system";
  if (ref.startsWith("sdk:") || ref.startsWith("sdkman:")) return "sdkman";
  if (ref.startsWith("path:")) return "path";
  if (ref.startsWith("home:")) return "home";
  return path.isAbsolute(ref) ? "path" : "configured";
}

async function listSdkmanJavaVersions(): Promise<string[]> {
  const dir = path.join(sdkmanDir(), "candidates", "java");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name !== "current").map((entry) => entry.name);
  } catch {
    return [];
  }
}

function sdkmanDir(): string {
  return process.env.SDKMAN_DIR ?? path.join(os.homedir(), ".sdkman");
}

async function commonJavaHomes(): Promise<string[]> {
  const homes: string[] = [];
  if (process.platform === "darwin" && (await pathExists("/usr/libexec/java_home"))) {
    try {
      const result = await execFileAsync("/usr/libexec/java_home", ["-V"], { timeout: 10000 });
      const combined = `${result.stdout}\n${result.stderr}`;
      for (const line of combined.split(/\r?\n/)) {
        const match = line.match(/(\/Library\/Java\/JavaVirtualMachines\/[^\s]+\/Contents\/Home)/);
        if (match) homes.push(match[1]);
      }
    } catch {
      // Ignore discovery failures.
    }
  }
  return homes;
}

function executable(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}
