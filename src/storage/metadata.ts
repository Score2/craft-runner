import fs from "node:fs/promises";
import path from "node:path";
import { CraftRunnerConfig, ServerMetadata } from "../lib/types.js";
import { ensureDir, readJson, writeJson } from "../lib/fsx.js";

type ServerIndexEntry = {
  id: string;
  metadata_path: string;
};

type ServerIndex = {
  servers: ServerIndexEntry[];
};

export class MetadataStore {
  private indexFile: string;

  constructor(private readonly config: CraftRunnerConfig) {
    this.indexFile = path.join(config.state_dir, "server-index.json");
  }

  async init(): Promise<void> {
    await ensureDir(this.config.state_dir);
    await ensureDir(path.join(this.config.state_dir, "locks"));
  }

  async getServer(id: string): Promise<ServerMetadata | undefined> {
    const index = await this.readIndex();
    const entry = index.servers.find((item) => item.id === id);
    if (!entry) return undefined;
    try {
      return JSON.parse(await fs.readFile(entry.metadata_path, "utf8")) as ServerMetadata;
    } catch {
      return undefined;
    }
  }

  async listServers(): Promise<ServerMetadata[]> {
    const index = await this.readIndex();
    const result: ServerMetadata[] = [];
    const existing: ServerIndexEntry[] = [];
    for (const entry of index.servers) {
      try {
        const server = JSON.parse(await fs.readFile(entry.metadata_path, "utf8")) as ServerMetadata;
        result.push(server);
        existing.push(entry);
      } catch {
        // Drop stale entries opportunistically.
      }
    }
    if (existing.length !== index.servers.length) {
      await this.writeIndex({ servers: existing });
    }
    return result;
  }

  async saveServer(server: ServerMetadata): Promise<void> {
    const metadataPath = path.join(server.base_dir, "servers", server.id, "metadata.json");
    await writeJson(metadataPath, server);
    const index = await this.readIndex();
    const without = index.servers.filter((entry) => entry.id !== server.id);
    without.push({ id: server.id, metadata_path: metadataPath });
    await this.writeIndex({ servers: without.sort((a, b) => a.id.localeCompare(b.id)) });
  }

  async removeServer(id: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex({ servers: index.servers.filter((entry) => entry.id !== id) });
  }

  locksDir(): string {
    return path.join(this.config.state_dir, "locks");
  }

  private async readIndex(): Promise<ServerIndex> {
    return readJson<ServerIndex>(this.indexFile, { servers: [] });
  }

  private async writeIndex(index: ServerIndex): Promise<void> {
    await writeJson(this.indexFile, index);
  }
}
