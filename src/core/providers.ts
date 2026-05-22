import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CoreCache } from "./cache.js";
import { CoreMetadata, CoreRef } from "../lib/types.js";
import { ensureDir, pathExists, sanitizeIdPart } from "../lib/fsx.js";
import { resolveJavaCommand } from "../java/discovery.js";

const execFileAsync = promisify(execFile);

export type CoreProviderInfo = {
  id: string;
  loaders: string[];
  status: "supported" | "partial" | "planned";
  notes: string;
};

export const CORE_PROVIDERS: CoreProviderInfo[] = [
  { id: "custom", loaders: ["custom"], status: "supported", notes: "Local jar import or HTTPS URL." },
  { id: "mojang-manifest", loaders: ["vanilla"], status: "supported", notes: "Mojang/Piston version manifest." },
  { id: "papermc-fill", loaders: ["paper", "folia"], status: "supported", notes: "PaperMC Fill Downloads Service." },
  { id: "purpur-api", loaders: ["purpur"], status: "supported", notes: "PurpurMC v2 Downloads API." },
  { id: "fabric-meta", loaders: ["fabric"], status: "supported", notes: "Fabric Meta server launcher jar." },
  { id: "minecraftforge-maven", loaders: ["forge"], status: "partial", notes: "Downloads installer; core installation is prepared centrally before start." },
  { id: "neoforge-maven", loaders: ["neoforge"], status: "partial", notes: "Downloads installer; core installation is prepared centrally before start." },
  { id: "spigot-buildtools", loaders: ["spigot", "craftbukkit"], status: "partial", notes: "Runs BuildTools in isolated cache workdir." }
];

export async function resolveCore(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  await cache.init();
  if (ref.core_id) {
    const core = await cache.get(ref.core_id);
    if (!core) throw new Error(`core not found: ${ref.core_id}`);
    return core;
  }

  const loader = ref.loader ?? "custom";
  if (loader === "custom") {
    return resolveCustom(ref, cache);
  }
  if (!ref.minecraft_version) {
    throw new Error("minecraft_version is required");
  }

  switch (loader) {
    case "vanilla":
      return resolveVanilla(ref, cache);
    case "paper":
    case "folia":
      return resolvePaperFamily(ref, cache);
    case "purpur":
      return resolvePurpur(ref, cache);
    case "fabric":
      return resolveFabric(ref, cache);
    case "forge":
      return resolveForgeInstaller(ref, cache);
    case "neoforge":
      return resolveNeoForgeInstaller(ref, cache);
    case "spigot":
    case "craftbukkit":
      return resolveSpigotBuildTools(ref, cache);
    default:
      throw new Error(`unsupported loader: ${loader}`);
  }
}

export async function searchCores(ref: Partial<CoreRef>, cache: CoreCache): Promise<unknown> {
  const loader = ref.loader;
  if (!loader) {
    return CORE_PROVIDERS;
  }
  if (loader === "paper" || loader === "folia") {
    return fetchJson(`https://fill.papermc.io/v3/projects/${loader}`, cache);
  }
  if (loader === "purpur") {
    if (ref.minecraft_version) {
      return fetchJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(ref.minecraft_version)}`, cache);
    }
    return fetchJson("https://api.purpurmc.org/v2/purpur", cache);
  }
  if (loader === "fabric") {
    return {
      game: await fetchJson("https://meta.fabricmc.net/v2/versions/game", cache),
      loader: await fetchJson("https://meta.fabricmc.net/v2/versions/loader", cache),
      installer: await fetchJson("https://meta.fabricmc.net/v2/versions/installer", cache)
    };
  }
  if (loader === "vanilla") {
    return fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", cache);
  }
  return CORE_PROVIDERS.find((provider) => provider.loaders.includes(loader));
}

async function resolveCustom(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  const minecraftVersion = ref.minecraft_version ?? "unknown";
  if (ref.path) {
    return cache.importLocal("custom", minecraftVersion, ref.path);
  }
  if (ref.url) {
    if (!ref.url.startsWith("https://")) {
      throw new Error("custom core URL must use https");
    }
    return cache.downloadToCore({
      id: `custom-${minecraftVersion}-${new URL(ref.url).pathname.split("/").pop() ?? "server"}`,
      loader: "custom",
      minecraft_version: minecraftVersion,
      provider: "custom-url",
      source: ref.url
    });
  }
  throw new Error("custom core requires path or url");
}

async function resolveVanilla(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  const manifest = await fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", cache) as {
    latest: { release: string };
    versions: { id: string; url: string }[];
  };
  const version = ref.minecraft_version === "latest" ? manifest.latest.release : ref.minecraft_version!;
  const versionMeta = manifest.versions.find((item) => item.id === version);
  if (!versionMeta) throw new Error(`vanilla version not found: ${version}`);
  const detail = await fetchJson(versionMeta.url, cache) as {
    downloads?: { server?: { url: string; sha1?: string; size?: number } };
  };
  const server = detail.downloads?.server;
  if (!server) throw new Error(`vanilla server jar not available for ${version}`);
  return cache.downloadToCore({
    id: `vanilla-${version}`,
    loader: "vanilla",
    minecraft_version: version,
    build: version,
    provider: "mojang-manifest",
    source: server.url
  });
}

async function resolvePaperFamily(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  const project = ref.loader!;
  const version = ref.minecraft_version!;
  const builds = await fetchJson(`https://fill.papermc.io/v3/projects/${project}/versions/${encodeURIComponent(version)}/builds`, cache) as Array<{
    id: string | number;
    channel?: string;
    downloads?: Record<string, { url: string; checksums?: { sha256?: string } }>;
  }>;
  const wanted = ref.build && ref.build !== "latest" ? String(ref.build) : undefined;
  const build = wanted
    ? builds.find((item) => String(item.id) === wanted)
    : builds.find((item) => item.channel === "STABLE" && item.downloads?.["server:default"]?.url) ??
      builds.find((item) => item.downloads?.["server:default"]?.url);
  if (!build) throw new Error(`${project} build not found for ${version}`);
  const download = build.downloads?.["server:default"];
  if (!download) throw new Error(`${project} build has no server:default download`);
  return cache.downloadToCore({
    id: `${project}-${version}-${build.id}`,
    loader: project,
    minecraft_version: version,
    build: String(build.id),
    channel: build.channel,
    provider: "papermc-fill",
    source: download.url,
    expected_sha256: download.checksums?.sha256
  });
}

async function resolvePurpur(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  const version = ref.minecraft_version!;
  const build = ref.build && ref.build !== "latest" ? ref.build : "latest";
  const url = `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/${encodeURIComponent(build)}/download`;
  const resolvedBuild = build === "latest"
    ? ((await fetchJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}`, cache)) as { builds?: { latest?: string } }).builds?.latest ?? "latest"
    : build;
  return cache.downloadToCore({
    id: `purpur-${version}-${resolvedBuild}`,
    loader: "purpur",
    minecraft_version: version,
    build: resolvedBuild,
    provider: "purpur-api",
    source: url
  });
}

async function resolveFabric(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  const version = ref.minecraft_version!;
  const loaderVersion = ref.build && ref.build !== "latest"
    ? ref.build
    : ((await fetchJson("https://meta.fabricmc.net/v2/versions/loader", cache)) as Array<{ version: string; stable: boolean }>).find((item) => item.stable)?.version;
  const installerVersion = ((await fetchJson("https://meta.fabricmc.net/v2/versions/installer", cache)) as Array<{ version: string; stable: boolean }>).find((item) => item.stable)?.version;
  if (!loaderVersion || !installerVersion) {
    throw new Error("unable to resolve Fabric loader or installer version");
  }
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`;
  return cache.downloadToCore({
    id: `fabric-${version}-${loaderVersion}-${installerVersion}`,
    loader: "fabric",
    minecraft_version: version,
    build: loaderVersion,
    provider: "fabric-meta",
    source: url
  });
}

async function resolveForgeInstaller(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  if (!ref.build || ref.build === "latest") {
    throw new Error("forge requires build as full Forge version, e.g. 1.20.1-47.1.3");
  }
  const build = ref.build;
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(build)}/forge-${build}-installer.jar`;
  return cache.downloadToCore({
    id: `forge-${build}`,
    loader: "forge",
    minecraft_version: ref.minecraft_version!,
    build,
    provider: "minecraftforge-maven",
    source: url,
    kind: "installer",
    launch: { type: "installer", install_args: ["--installServer"] }
  });
}

async function resolveNeoForgeInstaller(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  if (!ref.build || ref.build === "latest") {
    throw new Error("neoforge requires build as full NeoForge version, e.g. 21.4.111-beta");
  }
  const build = ref.build;
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(build)}/neoforge-${build}-installer.jar`;
  return cache.downloadToCore({
    id: `neoforge-${build}`,
    loader: "neoforge",
    minecraft_version: ref.minecraft_version!,
    build,
    provider: "neoforge-maven",
    source: url,
    kind: "installer",
    launch: { type: "installer", install_args: ["--installServer"] }
  });
}

async function resolveSpigotBuildTools(ref: CoreRef, cache: CoreCache): Promise<CoreMetadata> {
  const loader = ref.loader!;
  const rev = ref.minecraft_version ?? ref.build ?? "latest";
  const id = `${loader}-${rev}`;
  const existing = await cache.get(id);
  if (existing) return existing;

  const workDir = path.join(cache.coresDir, "_buildtools", sanitizeIdPart(`${loader}-${rev}`));
  await ensureDir(workDir);
  const buildTools = path.join(workDir, "BuildTools.jar");
  if (!(await pathExists(buildTools))) {
    await cache.downloadToCore({
      id: `buildtools-${Date.now()}`,
      loader: "_tools",
      minecraft_version: "buildtools",
      provider: "spigot-buildtools",
      source: "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar"
    }).then(async (core) => {
      await fs.copyFile(core.file_path, buildTools);
    });
  }

  const java = await resolveJavaCommand(process.env.CRAFT_RUNNER_JAVA_REF ?? "system");
  await execFileAsync(java, ["-jar", buildTools, "--rev", rev], { cwd: workDir, timeout: 20 * 60 * 1000 });
  const files = await fs.readdir(workDir);
  const prefix = loader === "craftbukkit" ? "craftbukkit-" : "spigot-";
  const jar = files.find((file) => file.startsWith(prefix) && file.endsWith(".jar"));
  if (!jar) throw new Error(`BuildTools did not produce ${loader} jar`);
  return cache.importLocal(loader, rev, path.join(workDir, jar), loader);
}

async function fetchJson(url: string, cache: CoreCache): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": cache.userAgent() } });
  if (!response.ok) {
    throw new Error(`request failed ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
