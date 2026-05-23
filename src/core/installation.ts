import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { CoreCache } from "./cache.js";
import { CoreMetadata, ServerMetadata, MaterializedCore } from "../lib/types.js";
import { ensureDir, pathExists, readJson, writeJson } from "../lib/fsx.js";
import { resolveJavaCommand } from "../java/discovery.js";

type PreparedCore = {
  core_id: string;
  install_dir: string;
  launch: {
    command: "java" | "sh" | "cmd";
    args: string[];
    cwd: string;
  };
  prepared_at: string;
};

const SHAREABLE_ENTRIES = [
  "libraries",
  "cache",
  ".fabric",
  "run.sh",
  "run.bat",
  "user_jvm_args.txt"
];

export class CoreInstallationManager {
  constructor(private readonly cache: CoreCache) {}

  async prepare(core: CoreMetadata, javaRef = "system"): Promise<PreparedCore> {
    const installDir = this.cache.installDir(core);
    await ensureDir(installDir);
    await withPrepareLock(this.cache.lockDir(core), async () => {
      const manifest = await this.readManifest(installDir);
      if (manifest?.core_id === core.id && await this.launchExists(manifest)) {
        return;
      }
      if (core.kind === "installer") {
        await this.prepareInstaller(core, installDir, javaRef);
      } else {
        await this.prepareJar(core, installDir);
      }
      await writeJson(path.join(installDir, "manifest.json"), {
        core_id: core.id,
        loader: core.loader,
        minecraft_version: core.minecraft_version,
        prepared_at: new Date().toISOString()
      });
    });

    const launch = await this.resolveLaunch(core, installDir);
    return {
      core_id: core.id,
      install_dir: installDir,
      launch,
      prepared_at: new Date().toISOString()
    };
  }

  async materialize(core: CoreMetadata, server: ServerMetadata): Promise<MaterializedCore> {
    const prepared = await this.prepare(core, server.java_ref ?? "system");
    const links: MaterializedCore["links"] = [];
    for (const entry of SHAREABLE_ENTRIES) {
      const source = path.join(prepared.install_dir, entry);
      if (!(await pathExists(source))) continue;
      const target = path.join(server.server_dir, entry);
      const strategy = await materializePath(source, target);
      links.push({ source, target, strategy });
    }
    return {
      core_id: core.id,
      install_dir: prepared.install_dir,
      launch: {
        ...prepared.launch,
        cwd: server.server_dir
      },
      links,
      prepared_at: prepared.prepared_at
    };
  }

  private async prepareJar(core: CoreMetadata, installDir: string): Promise<void> {
    const target = path.join(installDir, "server.jar");
    if (!(await pathExists(target))) {
      await fs.copyFile(core.file_path, target);
    }
    await ensureDir(path.join(installDir, "libraries"));
    await ensureDir(path.join(installDir, "cache"));
    if (core.loader === "fabric") {
      await ensureDir(path.join(installDir, ".fabric"));
    }
  }

  private async prepareInstaller(core: CoreMetadata, installDir: string, javaRef: string): Promise<void> {
    const java = await resolveJavaCommand(javaRef);
    const installer = path.join(installDir, "installer.jar");
    if (!(await pathExists(installer))) {
      await fs.copyFile(core.file_path, installer);
    }
    const marker = path.join(installDir, ".craft-runner-installed");
    if (await pathExists(marker)) return;
    const logPath = path.join(installDir, "install.log");
    await execInstaller(java, installer, core.launch?.install_args ?? ["--installServer"], installDir, logPath);
    await fs.writeFile(marker, new Date().toISOString());
  }

  private async resolveLaunch(core: CoreMetadata, installDir: string): Promise<PreparedCore["launch"]> {
    if (core.kind === "installer") {
      const runBat = path.join(installDir, "run.bat");
      if (process.platform === "win32" && await pathExists(runBat)) {
        return { command: "cmd", args: ["/d", "/s", "/c", "run.bat", "nogui"], cwd: installDir };
      }
      const runSh = path.join(installDir, "run.sh");
      if (process.platform !== "win32" && await pathExists(runSh)) {
        return { command: "sh", args: ["run.sh", "nogui"], cwd: installDir };
      }
      const jar = await findFirstJar(installDir, ["forge-", "neoforge-"]);
      if (jar) {
        return { command: "java", args: ["-jar", path.relative(installDir, jar), "nogui"], cwd: installDir };
      }
      throw new Error("installer core did not produce a recognizable launch file");
    }
    return { command: "java", args: ["-jar", path.join(installDir, "server.jar"), "nogui"], cwd: installDir };
  }

  private async readManifest(installDir: string): Promise<{ core_id?: string } | undefined> {
    return readJson<{ core_id?: string } | undefined>(path.join(installDir, "manifest.json"), undefined);
  }

  private async launchExists(manifest: { core_id?: string }): Promise<boolean> {
    return Boolean(manifest.core_id);
  }
}

async function withPrepareLock<T>(lockDir: string, fn: () => Promise<T>): Promise<T> {
  await ensureDir(lockDir);
  const lockFile = path.join(lockDir, "prepare.lock");
  let handle: fs.FileHandle | undefined;
  while (!handle) {
    try {
      handle = await fs.open(lockFile, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await fs.rm(lockFile, { force: true });
  }
}

async function materializePath(source: string, target: string): Promise<"symlink" | "hardlink" | "copy"> {
  await fs.rm(target, { recursive: true, force: true });
  await ensureDir(path.dirname(target));
  const stat = await fs.lstat(source);
  try {
    await fs.symlink(source, target, stat.isDirectory() ? "dir" : "file");
    return "symlink";
  } catch {
    if (stat.isFile()) {
      try {
        await fs.link(source, target);
        return "hardlink";
      } catch {
        // Fall through to copy.
      }
    }
    await copyRecursive(source, target);
    return "copy";
  }
}

async function copyRecursive(source: string, target: string): Promise<void> {
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    await ensureDir(target);
    for (const entry of await fs.readdir(source)) {
      await copyRecursive(path.join(source, entry), path.join(target, entry));
    }
  } else {
    await fs.copyFile(source, target);
  }
}

async function execInstaller(java: string, installer: string, args: string[], cwd: string, logPath: string): Promise<void> {
  await ensureDir(path.dirname(logPath));
  const outFd = fsSync.openSync(logPath, "a");
  const errFd = fsSync.openSync(logPath, "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(java, ["-jar", installer, ...args], { cwd, stdio: ["ignore", outFd, errFd] });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`installer exited with code ${code}`)));
    });
  } finally {
    fsSync.closeSync(outFd);
    fsSync.closeSync(errFd);
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
