import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServerManager } from "../server/manager.js";
import { CORE_PROVIDERS, resolveCore, searchCores } from "../core/providers.js";
import { getJavaInfo, listJavaInstallations, validateJavaForMinecraft } from "../java/discovery.js";
import { getAgentJar } from "../debug/agentJar.js";
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

export function createMcpServer(manager = new ServerManager()): McpServer {
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

  tool("create_server", "Create a local Minecraft server.", {
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

  tool("list_servers", "List known local test servers.", {}, () => manager.list());

  tool("get_server", "Get one server status and metadata.", {
    server_id: z.string()
  }, (args) => manager.get(args.server_id));

  tool("start_server", "Start a local server in the background.", {
    server_id: z.string()
  }, (args) => manager.start(args.server_id));

  tool("stop_server", "Stop a local server.", {
    server_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.stop(args.server_id, args.timeout_ms));

  tool("restart_server", "Restart a local server.", {
    server_id: z.string()
  }, (args) => manager.restart(args.server_id));

  tool("destroy_server", "Stop and remove a server.", {
    server_id: z.string(),
    delete_files: z.boolean().optional()
  }, (args) => manager.destroy(args.server_id, args.delete_files ?? true));

  tool("put_server_file", "Write or copy a file into a server directory.", {
    server_id: z.string(),
    target_path: z.string(),
    content: z.string().optional(),
    source_path: z.string().optional(),
    overwrite: z.boolean().optional()
  }, (args) => manager.putFile(args.server_id, args.target_path, {
    content: args.content,
    source_path: args.source_path,
    overwrite: args.overwrite
  }));

  tool("put_server_files", "Write multiple content files into a server.", {
    server_id: z.string(),
    files: z.array(z.object({
      target_path: z.string(),
      content: z.string(),
      overwrite: z.boolean().optional()
    }))
  }, async (args) => {
    const results = [];
    for (const file of args.files) {
      results.push(await manager.putFile(args.server_id, file.target_path, {
        content: file.content,
        overwrite: file.overwrite
      }));
    }
    return results;
  });

  tool("add_plugin", "Copy a plugin jar into plugins/ for a server.", {
    server_id: z.string(),
    plugin_path: z.string(),
    plugin_name: z.string().optional()
  }, (args) => manager.addPlugin(args.server_id, args.plugin_path, args.plugin_name));

  tool("remove_server_file", "Remove a file or directory inside a server.", {
    server_id: z.string(),
    target_path: z.string()
  }, (args) => manager.removeFile(args.server_id, args.target_path));

  tool("list_server_files", "List files inside a server.", {
    server_id: z.string(),
    path: z.string().optional()
  }, (args) => manager.listFiles(args.server_id, args.path));

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

  tool("tail_server_log", "Read the last lines of a server log.", {
    server_id: z.string(),
    lines: z.number().int().optional(),
    file: z.string().optional()
  }, (args) => manager.tailLog(args.server_id, args.lines, args.file));

  tool("read_server_log", "Read a line range or byte range from a server log.", {
    server_id: z.string(),
    from_line: z.number().int().optional(),
    to_line: z.number().int().optional(),
    offset: z.number().int().optional(),
    limit: z.number().int().optional(),
    file: z.string().optional()
  }, (args) => manager.readLog(args.server_id, args));

  tool("wait_server_ready", "Wait for a server ready log line.", {
    server_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.waitReady(args.server_id, args.timeout_ms));

  tool("send_server_command", "Send a command through RCON.", {
    server_id: z.string(),
    command: z.string()
  }, (args) => manager.sendCommand(args.server_id, args.command));

  tool("get_server_events", "Get lifecycle events for a server.", {
    server_id: z.string()
  }, (args) => manager.getEvents(args.server_id));

  tool("list_java_installations", "List discovered Java installations.", {}, () => listJavaInstallations());

  tool("get_java_info", "Inspect a Java reference.", {
    java_ref: z.string().optional()
  }, (args) => getJavaInfo(args.java_ref ?? "system"));

  tool("validate_java_for_core", "Validate Java compatibility for a Minecraft version.", {
    java_ref: z.string().optional(),
    minecraft_version: z.string()
  }, (args) => validateJavaForMinecraft(args.java_ref, args.minecraft_version));

  tool("debug_install_agent", "Install the multi-platform JS debug agent into a local test server.", {
    server_id: z.string(),
    rebuild: z.boolean().optional()
  }, async (args) => manager.installDebugAgent(args.server_id, await getAgentJar({ rebuild: args.rebuild })));

  tool("debug_agent_status", "Inspect debug agent mailbox status for a local test server.", {
    server_id: z.string()
  }, (args) => manager.debugAgentStatus(args.server_id));

  tool("debug_eval_js", "Execute JavaScript inside a running test server through the file mailbox agent.", {
    server_id: z.string(),
    code: z.string(),
    thread: z.enum(["main", "async"]).optional(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.debugEvalJs({
    server_id: args.server_id,
    code: args.code,
    thread: args.thread,
    timeout_ms: args.timeout_ms
  }));

  tool("debug_eval_js_file", "Execute a local JavaScript file inside a running test server through the debug agent.", {
    server_id: z.string(),
    file: z.string(),
    thread: z.enum(["main", "async"]).optional(),
    timeout_ms: z.number().int().optional()
  }, async (args) => manager.debugEvalJs({
    server_id: args.server_id,
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
