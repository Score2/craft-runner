import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server exposes craft-runner tools over stdio", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/bin/mcp.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({ name: "craft-runner-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.equal(names.has("create_server"), true);
    assert.equal(names.has("get_stats"), true);
    assert.equal(names.has("kill_server"), true);
    assert.equal(names.has("download_core"), true);
    assert.equal(names.has("read_server_log"), true);
    assert.equal(names.has("list_java_installations"), true);
    assert.equal(names.has("debug_install_agent"), true);
    assert.equal(names.has("debug_connect_agent"), true);
    assert.equal(names.has("debug_agent_api"), true);
    assert.equal(names.has("debug_eval_js"), true);
    assert.equal(names.has("hot_plugin_capabilities"), true);
    assert.equal(names.has("hot_load_plugin"), true);
    assert.equal(names.has("hot_unload_plugin"), true);
    assert.equal(names.has("hot_reload_plugin"), true);

    const docs = await client.callTool({ name: "debug_agent_api", arguments: {} });
    const content = docs.content as Array<{ type: string; text?: string }>;
    const text = content.find((item) => item.type === "text")?.text ?? "";
    assert.match(text, /cr\.common/);
    assert.match(text, /cr\.platform/);
    assert.match(text, /hot_load_plugin/);

    const stats = await client.callTool({ name: "get_stats", arguments: {} });
    const statsContent = stats.content as Array<{ type: string; text?: string }>;
    const statsText = statsContent.find((item) => item.type === "text")?.text ?? "";
    assert.match(statsText, /"servers"/);
    assert.match(statsText, /"disk"/);
  } finally {
    await client.close();
  }
});

test("MCP debug agent rebuild does not corrupt stdio transport", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-mcp-rebuild-"));
  const jar = path.join(root, "server.jar");
  await fs.writeFile(jar, "fake jar");
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/bin/mcp.js"],
    cwd: process.cwd(),
    env: compactEnv({
      ...process.env,
      CRAFT_RUNNER_CACHE_DIR: path.join(root, "cache"),
      CRAFT_RUNNER_SERVER_BASE_DIR: path.join(root, "servers"),
      CRAFT_RUNNER_STATE_DIR: path.join(root, "state")
    }),
    stderr: "pipe"
  });
  const client = new Client({ name: "craft-runner-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    await client.callTool({
      name: "create_server",
      arguments: {
        id: "mcp-rebuild-test",
        core_ref: {
          loader: "custom",
          minecraft_version: "1.20.4",
          path: jar
        }
      }
    });
    await client.callTool({
      name: "debug_install_agent",
      arguments: {
        server_id: "mcp-rebuild-test",
        rebuild: true
      }
    });
    const servers = await client.callTool({ name: "list_servers", arguments: {} });
    const content = servers.content as Array<{ type: string; text?: string }>;
    const text = content.find((item) => item.type === "text")?.text ?? "";
    assert.match(text, /mcp-rebuild-test/);
  } finally {
    await client.close();
  }
});

function compactEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
