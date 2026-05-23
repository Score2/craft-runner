import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvironmentManager } from "../env/manager.js";
import { CORE_PROVIDERS, resolveCore, searchCores } from "../core/providers.js";
import { getJavaInfo, listJavaInstallations, validateJavaForMinecraft } from "../java/discovery.js";
import { getBukkitAgentJar } from "../debug/agentJar.js";
import fs from "node:fs/promises";

const CoreRefSchema = z.object({
  core_id: z.string().optional(),
  loader: z.string().optional(),
  minecraft_version: z.string().optional(),
  build: z.string().optional(),
  channel: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional()
});

const JsonRecordSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export function createMcpServer(manager = new EnvironmentManager()): McpServer {
  const server = new McpServer({
    name: "craft-runner",
    version: "0.1.0"
  });

  const tool = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: T,
    handler: (args: Record<string, any>) => Promise<unknown> | unknown
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: inputSchema as any },
      async (args: any) => jsonResult(await handler(args)) as any
    );
  };

  tool("create_environment", "Create a local Minecraft server test environment.", {
    id: z.string().optional(),
    core_ref: CoreRefSchema,
    base_dir: z.string().optional(),
    persistent: z.boolean().optional(),
    memory: z.object({ xms: z.string().optional(), xmx: z.string().optional() }).optional(),
    java_ref: z.string().optional(),
    java_args: z.array(z.string()).optional(),
    server_properties: JsonRecordSchema.optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    rcon: z.object({
      enabled: z.boolean().optional(),
      port: z.number().int().optional(),
      password: z.string().optional()
    }).optional(),
    accept_eula: z.boolean().optional(),
    start: z.boolean().optional()
  }, (args) => manager.create(args as any));

  tool("list_environments", "List known local test environments.", {}, () => manager.list());

  tool("get_environment", "Get one environment status and metadata.", {
    env_id: z.string()
  }, (args) => manager.get(args.env_id));

  tool("start_environment", "Start a local environment in the background.", {
    env_id: z.string()
  }, (args) => manager.start(args.env_id));

  tool("stop_environment", "Stop a local environment.", {
    env_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.stop(args.env_id, args.timeout_ms));

  tool("restart_environment", "Restart a local environment.", {
    env_id: z.string()
  }, (args) => manager.restart(args.env_id));

  tool("destroy_environment", "Stop and remove an environment.", {
    env_id: z.string(),
    delete_files: z.boolean().optional()
  }, (args) => manager.destroy(args.env_id, args.delete_files ?? true));

  tool("put_environment_file", "Write or copy a file into an environment server directory.", {
    env_id: z.string(),
    target_path: z.string(),
    content: z.string().optional(),
    source_path: z.string().optional(),
    overwrite: z.boolean().optional()
  }, (args) => manager.putFile(args.env_id, args.target_path, {
    content: args.content,
    source_path: args.source_path,
    overwrite: args.overwrite
  }));

  tool("put_environment_files", "Write multiple content files into an environment.", {
    env_id: z.string(),
    files: z.array(z.object({
      target_path: z.string(),
      content: z.string(),
      overwrite: z.boolean().optional()
    }))
  }, async (args) => {
    const results = [];
    for (const file of args.files) {
      results.push(await manager.putFile(args.env_id, file.target_path, {
        content: file.content,
        overwrite: file.overwrite
      }));
    }
    return results;
  });

  tool("add_plugin", "Copy a plugin jar into plugins/ for an environment.", {
    env_id: z.string(),
    plugin_path: z.string(),
    plugin_name: z.string().optional()
  }, (args) => manager.addPlugin(args.env_id, args.plugin_path, args.plugin_name));

  tool("remove_environment_file", "Remove a file or directory inside an environment.", {
    env_id: z.string(),
    target_path: z.string()
  }, (args) => manager.removeFile(args.env_id, args.target_path));

  tool("list_environment_files", "List files inside an environment.", {
    env_id: z.string(),
    path: z.string().optional()
  }, (args) => manager.listFiles(args.env_id, args.path));

  tool("list_core_providers", "List available Minecraft server core providers.", {}, () => CORE_PROVIDERS);

  tool("search_cores", "Search versions/builds from a core provider.", {
    loader: z.string().optional(),
    minecraft_version: z.string().optional(),
    build: z.string().optional()
  }, (args) => searchCores(args, manager.coreCache));

  tool("download_core", "Download or build a server core into the shared cache.", {
    core_ref: CoreRefSchema
  }, (args) => resolveCore(args.core_ref, manager.coreCache));

  tool("import_core", "Import a local jar or HTTPS URL into the shared core cache.", {
    loader: z.string().optional(),
    minecraft_version: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional()
  }, (args) => resolveCore({ ...args, loader: args.loader ?? "custom" }, manager.coreCache));

  tool("list_cores", "List cached server cores.", {}, () => manager.coreCache.list());

  tool("remove_core", "Remove a cached server core.", {
    core_id: z.string()
  }, (args) => manager.coreCache.remove(args.core_id));

  tool("verify_core", "Verify a cached server core sha256.", {
    core_id: z.string()
  }, (args) => manager.coreCache.verify(args.core_id));

  tool("tail_environment_log", "Read the last lines of an environment log.", {
    env_id: z.string(),
    lines: z.number().int().optional(),
    file: z.string().optional()
  }, (args) => manager.tailLog(args.env_id, args.lines, args.file));

  tool("read_environment_log", "Read a line range or byte range from an environment log.", {
    env_id: z.string(),
    from_line: z.number().int().optional(),
    to_line: z.number().int().optional(),
    offset: z.number().int().optional(),
    limit: z.number().int().optional(),
    file: z.string().optional()
  }, (args) => manager.readLog(args.env_id, args));

  tool("wait_environment_ready", "Wait for a server ready log line.", {
    env_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.waitReady(args.env_id, args.timeout_ms));

  tool("send_server_command", "Send a command through RCON.", {
    env_id: z.string(),
    command: z.string()
  }, (args) => manager.sendCommand(args.env_id, args.command));

  tool("get_environment_events", "Get lifecycle events for an environment.", {
    env_id: z.string()
  }, (args) => manager.getEvents(args.env_id));

  tool("list_java_installations", "List discovered Java installations.", {}, () => listJavaInstallations());

  tool("get_java_info", "Inspect a Java reference.", {
    java_ref: z.string().optional()
  }, (args) => getJavaInfo(args.java_ref ?? "system"));

  tool("validate_java_for_core", "Validate Java compatibility for a Minecraft version.", {
    java_ref: z.string().optional(),
    minecraft_version: z.string()
  }, (args) => validateJavaForMinecraft(args.java_ref, args.minecraft_version));

  tool("debug_install_agent", "Install the Bukkit-family JS debug agent into a local test server.", {
    env_id: z.string(),
    rebuild: z.boolean().optional()
  }, async (args) => manager.installDebugAgent(args.env_id, await getBukkitAgentJar({ rebuild: args.rebuild })));

  tool("debug_agent_status", "Inspect debug agent mailbox status for a local test server.", {
    env_id: z.string()
  }, (args) => manager.debugAgentStatus(args.env_id));

  tool("debug_eval_js", "Execute JavaScript inside a running Bukkit-family test server through the file mailbox agent.", {
    env_id: z.string(),
    code: z.string(),
    thread: z.enum(["main", "async"]).optional(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.debugEvalJs({
    env_id: args.env_id,
    code: args.code,
    thread: args.thread,
    timeout_ms: args.timeout_ms
  }));

  tool("debug_eval_js_file", "Execute a local JavaScript file inside a running Bukkit-family test server through the debug agent.", {
    env_id: z.string(),
    file: z.string(),
    thread: z.enum(["main", "async"]).optional(),
    timeout_ms: z.number().int().optional()
  }, async (args) => manager.debugEvalJs({
    env_id: args.env_id,
    code: await fs.readFile(args.file, "utf8"),
    thread: args.thread,
    timeout_ms: args.timeout_ms
  }));

  return server;
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
