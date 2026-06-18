import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServerManager } from "../server/manager.js";
import { boundedLineCount, eventsView, fileListView, logLineView, serverView, serversView } from "../server/views.js";
import { CORE_PROVIDERS, resolveCore, searchCores } from "../core/providers.js";
import { getJavaInfo, listJavaInstallations, validateJavaForMinecraft } from "../java/discovery.js";
import { getAgentJar } from "../debug/agentJar.js";
import { RemoteBridge } from "../remote/bridge.js";
import { packageInfo } from "../lib/packageInfo.js";
import fs from "node:fs/promises";

const CoreRefSchema = z.object({
  core_id: z.string().describe("Existing cached core id from list_cores. Use this when the core is already managed by craft-runner.").optional(),
  loader: z.string().describe("Server loader/provider, e.g. vanilla, paper, folia, purpur, fabric, forge, neoforge, spigot, craftbukkit, or custom.").optional(),
  minecraft_version: z.string().describe("Minecraft version for provider resolution and Java compatibility checks. Required unless using a cached core_id with metadata.").optional(),
  build: z.string().describe("Provider build/version selector, or latest where supported.").optional(),
  channel: z.string().describe("Optional provider channel selector where supported.").optional(),
  path: z.string().describe("Local jar path to import into craft-runner's shared core cache before use. For remote_host calls this local file is uploaded to the remote bridge as an imported cached core.").optional(),
  url: z.string().describe("HTTPS URL to download/import into craft-runner's shared core cache before use.").optional(),
  direct_path: z.string().describe("Existing server jar path on the execution host. This bypasses core cache import/upload and is launched directly with java -jar. For remote_host calls this path must exist on the remote host.").optional()
});

const JsonRecordSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export function createMcpServer(manager = new ServerManager()): McpServer {
  const server = new McpServer({
    name: "craft-runner",
    version: packageInfo().version
  });

  const tool = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: T,
    handler: (args: Record<string, any>) => Promise<unknown> | unknown
  ): void => {
    server.registerTool(
      name,
      {
        description: `${description} Optional remote_host routes this call over SSH to a compatible remote craftr bridge; if craftr is missing remotely, inspect/install it over SSH first.`,
        inputSchema: { remote_host: z.string().optional(), ...inputSchema } as any
      },
      async (args: any) => {
        if (args.remote_host) {
          return jsonResult(shapeMcpResult(name, args, await new RemoteBridge(args.remote_host).request(name, args))) as any;
        }
        const localArgs = { ...args };
        delete localArgs.remote_host;
        return jsonResult(shapeMcpResult(name, localArgs, await handler(localArgs))) as any;
      }
    );
  };

  tool("create_server", "Create a local Minecraft server. core_ref.path imports a jar into the shared core cache; core_ref.direct_path points at an existing jar on the execution host and bypasses core cache import/upload.", {
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

  tool("list_servers", "List known local test servers and active discovered agent endpoints. Returns compact metadata by default; use get_server_events for full event history.", {
    include_events: z.boolean().optional(),
    event_limit: z.number().int().optional()
  }, async (args) => serversView(await manager.list(), args));

  tool("get_stats", "Show current craft-runner statistics, including disk usage, cached cores, server counts, and running server count.", {}, () => manager.stats());

  tool("get_server", "Get one server status and compact metadata. Event history is summarized by default; use get_server_events for paged lifecycle events.", {
    server_id: z.string(),
    include_events: z.boolean().optional(),
    event_limit: z.number().int().optional()
  }, async (args) => serverView(await manager.get(args.server_id), args));

  tool("start_server", "Start a local server. craft-runner may use tmux internally for lifecycle isolation, but agents should not operate tmux directly; use MCP tools for lifecycle and commands.", {
    server_id: z.string()
  }, (args) => manager.start(args.server_id));

  tool("stop_server", "Stop a local server.", {
    server_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.stop(args.server_id, args.timeout_ms));

  tool("kill_server", "Force-kill a tracked local server process with SIGKILL. This is an emergency fallback for hung servers, stop_server timeouts, or explicit user requests; do not use it as the default shutdown path because it bypasses graceful Minecraft/plugin shutdown.", {
    server_id: z.string()
  }, (args) => manager.kill(args.server_id));

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

  tool("list_server_files", "List files inside a server with pagination to avoid oversized MCP responses.", {
    server_id: z.string(),
    path: z.string().optional(),
    offset: z.number().int().optional(),
    limit: z.number().int().optional()
  }, async (args) => fileListView(await manager.listFiles(args.server_id, args.path), args));

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
  }, (args) => manager.tailLog(args.server_id, boundedLineCount(args.lines, 120), args.file));

  tool("read_server_log", "Read a line range or byte range from a server log. Prefer offset/limit byte reads or small line windows; line output is capped by max_lines to avoid MCP truncation.", {
    server_id: z.string(),
    from_line: z.number().int().optional(),
    to_line: z.number().int().optional(),
    offset: z.number().int().optional(),
    limit: z.number().int().optional(),
    max_lines: z.number().int().optional(),
    file: z.string().optional()
  }, async (args) => logLineView(await manager.readLog(args.server_id, args), { max_lines: args.max_lines }));

  tool("wait_server_ready", "Wait for a server ready log line.", {
    server_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.waitReady(args.server_id, args.timeout_ms));

  tool("send_server_command", "Run a Minecraft/proxy console command through craft-runner. This is the required command path: do not use tmux, tmux send-keys, or debug_eval_js for command dispatch. Uses the debug agent socket/mailbox first, with legacy RCON or managed stdin only as backward-compatible fallbacks.", {
    server_id: z.string(),
    command: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.sendCommand(args.server_id, args.command, args.timeout_ms));

  tool("get_server_events", "Get paged lifecycle events for a server. Use limit/tail instead of requesting full history to avoid MCP response truncation.", {
    server_id: z.string(),
    offset: z.number().int().optional(),
    limit: z.number().int().optional(),
    tail: z.number().int().optional(),
    type: z.string().optional()
  }, async (args) => eventsView(await manager.getEvents(args.server_id), args));

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
  }, async (args) => {
    const target = await manager.get(args.server_id);
    return manager.installDebugAgent(args.server_id, await getAgentJar({
      rebuild: args.rebuild,
      loader: target.loader,
      minecraft_version: target.minecraft_version
    }));
  });

  tool("debug_agent_status", "Inspect debug agent mailbox status for a local test server.", {
    server_id: z.string()
  }, (args) => manager.debugAgentStatus(args.server_id));

  tool("debug_discover_agents", "Scan ~/.craft-runner/agents for manually installed Craft Runner agents. Discovered agents are temporary external endpoints and cannot be destroyed by craft-runner.", {}, () => manager.discoverDebugAgents());

  tool("debug_register_discovered_agent", "Register a scanned manual agent endpoint as an external server record so debug_eval_js and hot plugin tools can use it. This does not grant lifecycle/delete control.", {
    endpoint_name: z.string(),
    id: z.string().optional()
  }, (args) => manager.registerDiscoveredAgent(args.endpoint_name, args.id));

  tool("debug_agent_api", "Describe the JavaScript DSL exposed by the debug agent. Agents should call this before writing non-trivial debug_eval_js scripts.", {
    server_id: z.string().optional()
  }, async (args) => {
    const serverMeta = args.server_id ? await manager.get(args.server_id) : undefined;
    return debugAgentApiDocs(serverMeta?.loader);
  });

  tool("debug_eval_js", "Execute JavaScript inside a running test server through the debug agent. Do not use this to run console commands; call send_server_command instead. The agent preloads GraalJS on startup and logs executions to the server console with [CRA-REMOTE]. Prefer the documented DSL: cr.common is cross-platform; cr.platform is platform-specific. Call debug_agent_api for examples before complex scripts.", {
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

  tool("debug_eval_js_file", "Execute a local JavaScript file inside a running test server through the debug agent. Do not use this to run console commands; call send_server_command instead. The agent preloads GraalJS on startup and logs executions to the server console with [CRA-REMOTE]. Scripts can use cr.common for cross-platform helpers and cr.platform for platform-specific helpers.", {
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

  tool("hot_plugin_capabilities", "Inspect hot plugin lifecycle support for a server debug agent. Bukkit-family can load/unload; proxy platforms may report unsupported.", {
    server_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.hotPlugin({
    server_id: args.server_id,
    action: "capabilities",
    timeout_ms: args.timeout_ms
  }));

  tool("hot_list_plugins", "List plugins currently visible to the server debug agent.", {
    server_id: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.hotPlugin({
    server_id: args.server_id,
    action: "list",
    timeout_ms: args.timeout_ms
  }));

  tool("hot_load_plugin", "Runtime-load a Bukkit-family plugin jar through the debug agent. The jar is first copied into the server's plugins/ directory, including remote/external servers. Supports plugin.yml everywhere and paper-plugin.yml on Paper/Folia through reflective Paper internals. Do not use by default unless the user wants hot debugging or no restart.", {
    server_id: z.string(),
    plugin_path: z.string(),
    enable: z.boolean().optional(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.hotPlugin({
    server_id: args.server_id,
    action: "load",
    path: args.plugin_path,
    enable: args.enable,
    timeout_ms: args.timeout_ms
  }));

  tool("hot_unload_plugin", "Best-effort runtime unload of a Bukkit-family plugin through the debug agent. Prefer normal stop/restart unless the user explicitly wants hot debugging.", {
    server_id: z.string(),
    plugin_name: z.string(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.hotPlugin({
    server_id: args.server_id,
    action: "unload",
    plugin_name: args.plugin_name,
    timeout_ms: args.timeout_ms
  }));

  tool("hot_reload_plugin", "Best-effort unload then runtime-load a Bukkit-family plugin jar through the debug agent. The jar is first copied into the server's plugins/ directory, including remote/external servers. Prefer normal restart unless the user explicitly wants hot debugging.", {
    server_id: z.string(),
    plugin_name: z.string(),
    plugin_path: z.string(),
    enable: z.boolean().optional(),
    timeout_ms: z.number().int().optional()
  }, (args) => manager.hotPlugin({
    server_id: args.server_id,
    action: "reload",
    plugin_name: args.plugin_name,
    path: args.plugin_path,
    enable: args.enable,
    timeout_ms: args.timeout_ms
  }));

  return server;
}

function debugAgentApiDocs(loader?: string): Record<string, unknown> {
  const commonMethods = [
    "cr.common.platformName()",
    "cr.common.server()",
    "cr.common.plugin()",
    "cr.common.logger()",
    "cr.common.type(className)",
    "cr.common.classExists(className)",
    "cr.common.newInstance(className, ...args)",
    "cr.common.call(target, methodName, ...args)",
    "cr.common.callStatic(className, methodName, ...args)",
    "cr.common.get(target, fieldName)",
    "cr.common.set(target, fieldName, value)",
    "cr.common.getStatic(className, fieldName)",
    "cr.common.setStatic(className, fieldName, value)",
    "cr.common.enumValue(className, name)",
    "cr.common.list(...items)",
    "cr.common.setOf(...items)",
    "cr.common.mapOf(key, value, ...)",
    "cr.common.array(componentClassName, ...items)",
    "cr.common.className(value)",
    "cr.common.inspect(value)",
    "cr.common.methods(valueOrClassName)",
    "cr.common.fields(valueOrClassName)"
  ];
  const bukkitMethods = [
    "cr.platform.bukkit()",
    "cr.platform.isFolia()",
    "cr.platform.onlinePlayers()",
    "cr.platform.onlinePlayerNames()",
    "cr.platform.player(name)",
    "cr.platform.worlds()",
    "cr.platform.worldNames()",
    "cr.platform.world(name)",
    "cr.platform.plugins()",
    "cr.platform.plugin(name)",
    "cr.platform.console()",
    "cr.platform.dispatchCommand(command)",
    "cr.platform.material(name)",
    "cr.platform.namespacedKey(namespace, key)",
    "cr.platform.pluginKey(key)",
    "cr.platform.itemStack(materialName, amount)"
  ];
  return {
    namespace: "cr",
    rule: "Use cr.common for cross-platform Java/Minecraft reflection helpers. Use cr.platform only after checking platform capabilities because these methods depend on the loaded server platform. Never use debug_eval_js just to run a console command; call the MCP send_server_command tool.",
    file_endpoint: {
      layout: "~/.craft-runner/agents/<server-port>/",
      protocol: "Unix-like systems prefer agent.sock when available; otherwise write request JSON files into requests/ and read response JSON files from responses/. Windows uses file mailbox fallback.",
      notes: [
        "MCP-managed servers record the endpoint in debug_agent_status.mailbox_dir.",
        "Manually installed agents create a discoverable endpoint automatically; call debug_discover_agents, then debug_register_discovered_agent to use it.",
        "Use /craftragent status or /craftragent token in Bukkit-family, BungeeCord/Waterfall, and Velocity servers for direct inspection."
      ]
    },
    runtime_notes: [
      "debug_eval_js defaults to thread=main. Use thread=async only for non-server-state work.",
      "For console commands, always call send_server_command. Do not dispatch commands through JS and do not interact with tmux.",
      "The agent starts GraalJS library download/loading asynchronously during plugin startup.",
      "If JS library loading fails, a server operator can run /cra js-status and /cra js-load after fixing network/cache issues.",
      "Remote MCP executions are logged on the server console with the [CRA-REMOTE] prefix.",
      "Returned values are serialized into JSON-friendly values; large arrays/maps are truncated."
    ],
    current_loader_hint: loader ?? null,
    common: {
      methods: commonMethods,
      examples: [
        "cr.common.platformName()",
        "cr.common.callStatic('org.bukkit.Bukkit', 'getOnlinePlayers').size()",
        "cr.common.inspect(cr.common.server())",
        "cr.common.methods('net.minecraft.server.MinecraftServer')"
      ]
    },
    platform: {
      generic: {
        methods: [
          "cr.platform.name()",
          "cr.platform.server()",
          "cr.platform.plugin()",
          "cr.platform.serverClassName()",
          "cr.platform.capabilities()",
          "cr.platform.supports(capability)"
        ]
      },
      bukkit_family: {
        applies_to: ["bukkit", "spigot", "paper", "purpur", "folia"],
        methods: bukkitMethods,
        hot_plugin_tools: [
          "hot_plugin_capabilities(server_id)",
          "hot_list_plugins(server_id)",
          "hot_load_plugin(server_id, plugin_path, enable?)",
          "hot_unload_plugin(server_id, plugin_name)",
          "hot_reload_plugin(server_id, plugin_name, plugin_path, enable?)"
        ],
        hot_plugin_notes: [
          "Hot plugin lifecycle is exposed as MCP tools, not as JS snippets.",
          "Do not choose hot load/unload/reload by default. Prefer a normal server restart for plugin changes unless the user explicitly wants hot debugging, fast iteration, or quick visual/string tuning.",
          "hot_load_plugin and hot_reload_plugin copy the supplied jar into the target server's plugins/ directory before asking the agent to load it.",
          "If hot reload/unload produces strange behavior, stale state, missing commands, classloader issues, scheduler issues, or dependency inconsistencies, first consider whether a full server restart is the correct fix. Respect explicit user instructions that they do not want a restart.",
          "plugin.yml jars use the public Bukkit/Paper runtime path. paper-plugin.yml jars are supported on Paper/Folia through reflective Paper internals.",
          "On Paper 1.20.5+ plugin remapping is delegated to the running server.",
          "Unload/reload are best-effort and may leave plugin-owned static state, threads, native resources, or third-party registries behind."
        ],
        examples: [
          "cr.platform.onlinePlayerNames()",
          "cr.platform.isFolia()",
          "cr.platform.itemStack('DIAMOND', 1)"
        ]
      },
      fabric_forge_neoforge: {
        status: "platform-specific shortcut methods are intentionally minimal for now; use cr.common reflection plus cr.platform.server() for loader-specific internals."
      },
      proxy_family: {
        applies_to: ["bungee", "bungeecord", "waterfall", "velocity"],
        command: "/craftragent is registered through Incendo Cloud where the platform supports commands.",
        methods: [
          "cr.platform.onlinePlayerNames()",
          "cr.platform.serverNames()",
          "cr.platform.onlineCount()"
        ],
        hot_plugin_notes: [
          "BungeeCord/Waterfall and Velocity hot load/unload/reload are best-effort and use platform internals reflectively.",
          "Prefer restart for proxy plugin changes unless the user explicitly wants hot debugging.",
          "Velocity has no public unload API; runtime unloading removes detectable listeners, commands, scheduler tasks, registry entries, and classloaders where possible."
        ]
      }
    },
    legacy_globals: {
      note: "Raw globals remain available as escape hatches, but new scripts should prefer cr.*.",
      names: ["Bukkit when present", "MinecraftServer when present", "server", "plugin", "logger", "agent", "platform"]
    }
  };
}

function shapeMcpResult(toolName: string, args: Record<string, any>, value: unknown): unknown {
  if (isRecord(value) && isRecord(value.remote) && "result" in value) {
    return {
      ...value,
      result: shapeToolResult(toolName, args, value.result)
    };
  }
  return shapeToolResult(toolName, args, value);
}

function shapeToolResult(toolName: string, args: Record<string, any>, value: unknown): unknown {
  if (toolName === "list_servers" && Array.isArray(value) && value.every(isServerMetadataLike)) {
    return serversView(value as any, args);
  }
  if (toolName === "get_server" && isServerMetadataLike(value)) {
    return serverView(value as any, args);
  }
  if (toolName === "get_server_events" && Array.isArray(value)) {
    return eventsView(value as any, args);
  }
  if (toolName === "list_server_files" && Array.isArray(value)) {
    return fileListView(value as string[], args);
  }
  if ((toolName === "read_server_log" || toolName === "tail_server_log") && isRecord(value)) {
    return logLineView(value as any, { max_lines: args.max_lines });
  }
  return value;
}

function jsonResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  const maxBytes = maxMcpTextBytes();
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return {
      content: [
        {
          type: "text" as const,
          text
        }
      ]
    };
  }
  const preview = truncateUtf8(text, Math.max(1024, maxBytes - 2048));
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          truncated: true,
          original_bytes: Buffer.byteLength(text, "utf8"),
          max_text_bytes: maxBytes,
          hint: "The MCP result was too large for a single tool response. Retry with limit, offset, tail, include_events=false, or a narrower query.",
          preview
        }, null, 2)
      }
    ]
  };
}

function maxMcpTextBytes(): number {
  const value = Number(process.env.CRAFT_RUNNER_MCP_MAX_TEXT_BYTES ?? 60000);
  return Number.isFinite(value) && value >= 4096 ? Math.floor(value) : 60000;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, "") + "\n... truncated by craft-runner ...";
}

function isServerMetadataLike(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.server_dir === "string"
    && Array.isArray(value.events);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
