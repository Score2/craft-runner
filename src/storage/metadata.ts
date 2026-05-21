import fs from "node:fs/promises";
import path from "node:path";
import { CraftRunnerConfig, EnvironmentMetadata } from "../lib/types.js";
import { ensureDir, readJson, writeJson } from "../lib/fsx.js";

type EnvIndexEntry = {
  id: string;
  metadata_path: string;
};

type EnvIndex = {
  environments: EnvIndexEntry[];
};

export class MetadataStore {
  private indexFile: string;

  constructor(private readonly config: CraftRunnerConfig) {
    this.indexFile = path.join(config.state_dir, "env-index.json");
  }

  async init(): Promise<void> {
    await ensureDir(this.config.state_dir);
    await ensureDir(path.join(this.config.state_dir, "locks"));
  }

  async getEnvironment(id: string): Promise<EnvironmentMetadata | undefined> {
    const index = await this.readIndex();
    const entry = index.environments.find((item) => item.id === id);
    if (!entry) return undefined;
    try {
      return JSON.parse(await fs.readFile(entry.metadata_path, "utf8")) as EnvironmentMetadata;
    } catch {
      return undefined;
    }
  }

  async listEnvironments(): Promise<EnvironmentMetadata[]> {
    const index = await this.readIndex();
    const result: EnvironmentMetadata[] = [];
    const existing: EnvIndexEntry[] = [];
    for (const entry of index.environments) {
      try {
        const env = JSON.parse(await fs.readFile(entry.metadata_path, "utf8")) as EnvironmentMetadata;
        result.push(env);
        existing.push(entry);
      } catch {
        // Drop stale entries opportunistically.
      }
    }
    if (existing.length !== index.environments.length) {
      await this.writeIndex({ environments: existing });
    }
    return result;
  }

  async saveEnvironment(env: EnvironmentMetadata): Promise<void> {
    const metadataPath = path.join(env.base_dir, "envs", env.id, "metadata.json");
    await writeJson(metadataPath, env);
    const index = await this.readIndex();
    const without = index.environments.filter((entry) => entry.id !== env.id);
    without.push({ id: env.id, metadata_path: metadataPath });
    await this.writeIndex({ environments: without.sort((a, b) => a.id.localeCompare(b.id)) });
  }

  async removeEnvironment(id: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex({ environments: index.environments.filter((entry) => entry.id !== id) });
  }

  locksDir(): string {
    return path.join(this.config.state_dir, "locks");
  }

  private async readIndex(): Promise<EnvIndex> {
    return readJson<EnvIndex>(this.indexFile, { environments: [] });
  }

  private async writeIndex(index: EnvIndex): Promise<void> {
    await writeJson(this.indexFile, index);
  }
}
