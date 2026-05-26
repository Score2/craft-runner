import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ServerManager } from "../server/manager.js";
import { CORE_PROVIDERS, resolveCore, searchCores } from "../core/providers.js";
import { getJavaInfo, listJavaInstallations, validateJavaForMinecraft } from "../java/discovery.js";
import { getAgentJar } from "../debug/agentJar.js";
import { ensureDir } from "../lib/fsx.js";

export const BRIDGE_PROTOCOL = {
  major: 1,
  minor: 0
} as const;

export const PACKAGE_NAME = "@score2/craft-runner";
export const PACKAGE_VERSION = "1.0.1";

export type BridgeVersion = {
  name: string;
  version: string;
  bridge_protocol: typeof BRIDGE_PROTOCOL;
  capabilities: string[];
};

export type BridgeRequest = {
  schema: "craft-runner-bridge-request";
  version: 1;
  request_id: string;
  tool: string;
  arguments?: Record<string, any>;
};

export type BridgeResponse = {
  schema: "craft-runner-bridge-response";
  version: 1;
  request_id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

export function bridgeVersion(): BridgeVersion {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    bridge_protocol: BRIDGE_PROTOCOL,
    capabilities: [
      "server.lifecycle",
      "server.files",
      "server.logs",
      "core.cache",
      "java.discovery",
      "debug.agent",
      "hot.plugin"
    ]
  };
}

export async function handleBridgeRequest(input: string, manager = new ServerManager()): Promise<BridgeResponse> {
  let request: BridgeRequest;
  try {
    request = JSON.parse(input) as BridgeRequest;
  } catch (error) {
    return bridgeFailure("unknown", "invalid_json", error instanceof Error ? error.message : String(error));
  }

  if (request?.schema !== "craft-runner-bridge-request" || request.version !== 1 || !request.request_id || !request.tool) {
    return bridgeFailure(request?.request_id ?? "unknown", "invalid_request", "invalid bridge request schema");
  }

  try {
    return {
      schema: "craft-runner-bridge-response",
      version: 1,
      request_id: request.request_id,
      ok: true,
      result: await dispatchBridgeTool(request.tool, request.arguments ?? {}, manager, request.request_id)
    };
  } catch (error) {
    return bridgeFailure(
      request.request_id,
      "tool_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function dispatchBridgeTool(
  tool: string,
  args: Record<string, any>,
  manager = new ServerManager(),
  requestId: string = crypto.randomUUID()
): Promise<unknown> {
  const clean = { ...args };
  delete clean.remote_host;

  switch (tool) {
    case "create_server":
      return manager.create(clean as any);
    case "list_servers":
      return manager.list();
    case "get_stats":
      return manager.stats();
    case "get_server":
      return manager.get(required(clean.server_id, "server_id"));
    case "start_server":
      return manager.start(required(clean.server_id, "server_id"));
    case "stop_server":
      return manager.stop(required(clean.server_id, "server_id"), clean.timeout_ms);
    case "kill_server":
      return manager.kill(required(clean.server_id, "server_id"));
    case "restart_server":
      return manager.restart(required(clean.server_id, "server_id"));
    case "destroy_server":
      return manager.destroy(required(clean.server_id, "server_id"), clean.delete_files ?? true);
    case "put_server_file":
      return manager.putFile(required(clean.server_id, "server_id"), required(clean.target_path, "target_path"), {
        content: contentValue(clean),
        source_path: clean.source_path,
        overwrite: clean.overwrite
      });
    case "put_server_files": {
      const results = [];
      for (const file of clean.files ?? []) {
        results.push(await manager.putFile(required(clean.server_id, "server_id"), required(file.target_path, "target_path"), {
          content: contentValue(file),
          overwrite: file.overwrite
        }));
      }
      return results;
    }
    case "add_plugin": {
      if (typeof clean.plugin_content_base64 === "string") {
        const name = clean.plugin_name ?? path.basename(required(clean.plugin_path, "plugin_path"));
        return manager.putFile(required(clean.server_id, "server_id"), path.join("plugins", name), {
          content: Buffer.from(clean.plugin_content_base64, "base64"),
          overwrite: true
        });
      }
      return manager.addPlugin(required(clean.server_id, "server_id"), required(clean.plugin_path, "plugin_path"), clean.plugin_name);
    }
    case "remove_server_file":
      return manager.removeFile(required(clean.server_id, "server_id"), required(clean.target_path, "target_path"));
    case "list_server_files":
      return manager.listFiles(required(clean.server_id, "server_id"), clean.path);
    case "list_core_providers":
      return CORE_PROVIDERS;
    case "search_cores":
      return searchCores(clean, manager.coreCache);
    case "download_core":
      return resolveCore(clean.core_ref, manager.coreCache);
    case "import_core": {
      if (typeof clean.file_content_base64 === "string") {
        clean.path = await writeBridgeTempFile(requestId, clean.file_name ?? "core.jar", clean.file_content_base64);
      }
      return resolveCore({ ...clean, loader: clean.loader ?? "custom" }, manager.coreCache);
    }
    case "list_cores":
      return manager.coreCache.list();
    case "remove_core":
      return manager.coreCache.remove(required(clean.core_id, "core_id"));
    case "verify_core":
      return manager.coreCache.verify(required(clean.core_id, "core_id"));
    case "tail_server_log":
      return manager.tailLog(required(clean.server_id, "server_id"), clean.lines, clean.file);
    case "read_server_log":
      return manager.readLog(required(clean.server_id, "server_id"), clean);
    case "wait_server_ready":
      return manager.waitReady(required(clean.server_id, "server_id"), clean.timeout_ms);
    case "send_server_command":
      return manager.sendCommand(required(clean.server_id, "server_id"), required(clean.command, "command"));
    case "get_server_events":
      return manager.getEvents(required(clean.server_id, "server_id"));
    case "list_java_installations":
      return listJavaInstallations();
    case "get_java_info":
      return getJavaInfo(clean.java_ref ?? "system");
    case "validate_java_for_core":
      return validateJavaForMinecraft(clean.java_ref, required(clean.minecraft_version, "minecraft_version"));
    case "debug_install_agent":
      return manager.installDebugAgent(required(clean.server_id, "server_id"), await getAgentJar({ rebuild: clean.rebuild }));
    case "debug_agent_status":
      return manager.debugAgentStatus(required(clean.server_id, "server_id"));
    case "debug_discover_agents":
      return manager.discoverDebugAgents();
    case "debug_register_discovered_agent":
      return manager.registerDiscoveredAgent(required(clean.endpoint_name, "endpoint_name"), clean.id);
    case "debug_agent_api": {
      const server = clean.server_id ? await manager.get(clean.server_id) : undefined;
      return {
        namespace: "cr",
        loader: server?.loader,
        rule: "Use cr.common for cross-platform Java/Minecraft reflection helpers. Use cr.platform only after checking platform capabilities because methods depend on the loaded server platform.",
        remote_bridge: true,
        note: "This response is served through craftr bridge. For full local examples, call debug_agent_api without remote_host or inspect project docs."
      };
    }
    case "debug_eval_js":
      return manager.debugEvalJs({
        server_id: required(clean.server_id, "server_id"),
        code: required(clean.code, "code"),
        thread: clean.thread,
        timeout_ms: clean.timeout_ms
      });
    case "debug_eval_js_file": {
      const code = typeof clean.code === "string" ? clean.code : await fs.readFile(required(clean.file, "file"), "utf8");
      return manager.debugEvalJs({
        server_id: required(clean.server_id, "server_id"),
        code,
        thread: clean.thread,
        timeout_ms: clean.timeout_ms
      });
    }
    case "hot_plugin_capabilities":
      return manager.hotPlugin({ server_id: required(clean.server_id, "server_id"), action: "capabilities", timeout_ms: clean.timeout_ms });
    case "hot_list_plugins":
      return manager.hotPlugin({ server_id: required(clean.server_id, "server_id"), action: "list", timeout_ms: clean.timeout_ms });
    case "hot_load_plugin": {
      const pluginPath = await remotePluginPath(clean, requestId);
      return manager.hotPlugin({
        server_id: required(clean.server_id, "server_id"),
        action: "load",
        path: pluginPath,
        enable: clean.enable,
        timeout_ms: clean.timeout_ms
      });
    }
    case "hot_unload_plugin":
      return manager.hotPlugin({
        server_id: required(clean.server_id, "server_id"),
        action: "unload",
        plugin_name: required(clean.plugin_name, "plugin_name"),
        timeout_ms: clean.timeout_ms
      });
    case "hot_reload_plugin": {
      const pluginPath = await remotePluginPath(clean, requestId);
      return manager.hotPlugin({
        server_id: required(clean.server_id, "server_id"),
        action: "reload",
        plugin_name: required(clean.plugin_name, "plugin_name"),
        path: pluginPath,
        enable: clean.enable,
        timeout_ms: clean.timeout_ms
      });
    }
    default:
      throw new Error(`unsupported bridge tool: ${tool}`);
  }
}

function bridgeFailure(requestId: string, code: string, message: string): BridgeResponse {
  return {
    schema: "craft-runner-bridge-response",
    version: 1,
    request_id: requestId,
    ok: false,
    error: { code, message }
  };
}

function contentValue(args: Record<string, any>): string | Buffer | undefined {
  if (typeof args.content_base64 === "string") {
    return Buffer.from(args.content_base64, "base64");
  }
  return args.content;
}

async function remotePluginPath(args: Record<string, any>, requestId: string): Promise<string> {
  if (typeof args.plugin_content_base64 === "string") {
    return writeBridgeTempFile(requestId, args.plugin_name ?? path.basename(required(args.plugin_path, "plugin_path")), args.plugin_content_base64);
  }
  return required(args.plugin_path, "plugin_path");
}

async function writeBridgeTempFile(requestId: string, fileName: string, base64: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "craft-runner-bridge", requestId);
  await ensureDir(dir);
  const target = path.join(dir, path.basename(fileName));
  await fs.writeFile(target, Buffer.from(base64, "base64"));
  return target;
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}
