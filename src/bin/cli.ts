#!/usr/bin/env node
import { EnvironmentManager } from "../env/manager.js";
import { getJavaInfo, listJavaInstallations } from "../java/discovery.js";
import { resolveCore } from "../core/providers.js";

const manager = new EnvironmentManager();
const [, , domain, action, ...rest] = process.argv;

try {
  const result = await run(domain, action, rest);
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function run(domain: string | undefined, action: string | undefined, args: string[]): Promise<unknown> {
  if (domain === "java" && action === "list") return listJavaInstallations();
  if (domain === "java" && action === "info") return getJavaInfo(args[0] ?? "system");
  if (domain === "env" && action === "list") return manager.list();
  if (domain === "env" && action === "start") return manager.start(required(args[0], "env id"));
  if (domain === "env" && action === "stop") return manager.stop(required(args[0], "env id"));
  if (domain === "env" && action === "destroy") return manager.destroy(required(args[0], "env id"));
  if (domain === "core" && action === "list") return manager.coreCache.list();
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
    "  craft-runner env destroy <id>"
  ].join("\n");
}
