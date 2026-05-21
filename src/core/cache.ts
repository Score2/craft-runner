import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { CraftRunnerConfig, CoreMetadata } from "../lib/types.js";
import { ensureDir, pathExists, readJson, sanitizeIdPart, writeJson } from "../lib/fsx.js";
import { sha256File } from "../lib/hash.js";

export class CoreCache {
  readonly coresDir: string;

  constructor(private readonly config: CraftRunnerConfig) {
    this.coresDir = path.join(config.cache_dir, "cores");
  }

  userAgent(): string {
    return this.config.user_agent;
  }

  async init(): Promise<void> {
    await ensureDir(this.coresDir);
    await ensureDir(path.join(this.config.cache_dir, "downloads"));
  }

  corePath(loader: string, minecraftVersion: string, id: string): string {
    return path.join(this.coresDir, sanitizeIdPart(loader), sanitizeIdPart(minecraftVersion), `${id}.jar`);
  }

  metadataPath(loader: string, minecraftVersion: string, id: string): string {
    return path.join(this.coresDir, sanitizeIdPart(loader), sanitizeIdPart(minecraftVersion), `${id}.json`);
  }

  async save(metadata: CoreMetadata): Promise<CoreMetadata> {
    await writeJson(this.metadataPath(metadata.loader, metadata.minecraft_version, metadata.id), metadata);
    return metadata;
  }

  async get(id: string): Promise<CoreMetadata | undefined> {
    for (const metadata of await this.list()) {
      if (metadata.id === id) {
        return metadata;
      }
    }
    return undefined;
  }

  async list(): Promise<CoreMetadata[]> {
    if (!(await pathExists(this.coresDir))) {
      return [];
    }
    const result: CoreMetadata[] = [];
    await collectJson(this.coresDir, result);
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  async remove(id: string): Promise<boolean> {
    const core = await this.get(id);
    if (!core) return false;
    await fs.rm(core.file_path, { force: true });
    await fs.rm(this.metadataPath(core.loader, core.minecraft_version, core.id), { force: true });
    return true;
  }

  async verify(id: string): Promise<{ ok: boolean; core?: CoreMetadata; actual_sha256?: string }> {
    const core = await this.get(id);
    if (!core || !(await pathExists(core.file_path))) {
      return { ok: false, core };
    }
    const actual = await sha256File(core.file_path);
    return { ok: actual === core.sha256, core, actual_sha256: actual };
  }

  async importLocal(
    loader: string,
    minecraftVersion: string,
    sourcePath: string,
    idPrefix = "custom"
  ): Promise<CoreMetadata> {
    const sha = await sha256File(sourcePath);
    const id = sanitizeIdPart(`${idPrefix}-${minecraftVersion}-${sha.slice(0, 12)}`);
    const dest = this.corePath(loader, minecraftVersion, id);
    await ensureDir(path.dirname(dest));
    if (!(await pathExists(dest))) {
      await fs.copyFile(sourcePath, dest);
    }
    const stat = await fs.stat(dest);
    return this.save({
      id,
      loader,
      minecraft_version: minecraftVersion,
      provider: "custom-local",
      source: sourcePath,
      file_path: dest,
      sha256: sha,
      checksum_source: "local",
      size: stat.size,
      kind: "jar",
      launch: { type: "jar" },
      downloaded_at: new Date().toISOString()
    });
  }

  async downloadToCore(options: {
    id: string;
    loader: string;
    minecraft_version: string;
    build?: string;
    channel?: string;
    provider: string;
    source: string;
    expected_sha256?: string;
    kind?: CoreMetadata["kind"];
    launch?: CoreMetadata["launch"];
  }): Promise<CoreMetadata> {
    const id = sanitizeIdPart(options.id);
    const dest = this.corePath(options.loader, options.minecraft_version, id);
    const metadataPath = this.metadataPath(options.loader, options.minecraft_version, id);

    if ((await pathExists(dest)) && (await pathExists(metadataPath))) {
      return readJson<CoreMetadata>(metadataPath, undefined as unknown as CoreMetadata);
    }

    await ensureDir(path.dirname(dest));
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await downloadFile(options.source, tmp, this.config.user_agent);
    const actualSha = await sha256File(tmp);
    if (options.expected_sha256 && options.expected_sha256 !== actualSha) {
      await fs.rm(tmp, { force: true });
      throw new Error(`sha256 mismatch for ${options.source}`);
    }
    await fs.rename(tmp, dest);
    const stat = await fs.stat(dest);
    return this.save({
      id,
      loader: options.loader,
      minecraft_version: options.minecraft_version,
      build: options.build,
      channel: options.channel,
      provider: options.provider,
      source: options.source,
      file_path: dest,
      sha256: actualSha,
      checksum_source: options.expected_sha256 ? "provider" : "local",
      size: stat.size,
      kind: options.kind ?? "jar",
      launch: options.launch ?? { type: options.kind === "installer" ? "installer" : "jar" },
      downloaded_at: new Date().toISOString()
    });
  }
}

async function downloadFile(url: string, target: string, userAgent: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent
    }
  });
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

async function collectJson(dir: string, result: CoreMetadata[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJson(full, result);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        result.push(JSON.parse(await fs.readFile(full, "utf8")) as CoreMetadata);
      } catch {
        // Ignore corrupt cache metadata.
      }
    }
  }
}
