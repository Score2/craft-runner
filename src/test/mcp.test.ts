import test from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(names.has("create_environment"), true);
    assert.equal(names.has("download_core"), true);
    assert.equal(names.has("read_environment_log"), true);
    assert.equal(names.has("list_java_installations"), true);
    assert.equal(names.has("debug_install_agent"), true);
    assert.equal(names.has("debug_eval_js"), true);
  } finally {
    await client.close();
  }
});
