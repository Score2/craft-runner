import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RemoteBridge } from "../remote/bridge.js";

test("RemoteBridge uses non-interactive SSH and sends bridge JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-remote-bridge-"));
  const bin = path.join(root, "bin");
  const ssh = path.join(bin, "ssh");
  const calls = path.join(root, "calls.jsonl");
  const payload = path.join(root, "plugin.jar");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(payload, Buffer.from([0, 1, 2, 3, 4]));
  await writeFakeSsh(ssh, calls);

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
  try {
    const result = await new RemoteBridge("lab-linux").request("add_plugin", {
      server_id: "remote-test",
      plugin_path: payload
    });

    assert.deepEqual(result.remote, {
      host: "lab-linux",
      craftr_version: "1.0.0",
      bridge_protocol: { major: 1, minor: 0 }
    });
    assert.deepEqual(result.result, {
      tool: "add_plugin",
      pluginName: "plugin.jar",
      pluginBytes: 5
    });

    const records = (await fs.readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.some((record) => record.args.includes("BatchMode=yes")), true);
    assert.equal(records.some((record) => record.args.includes("NumberOfPasswordPrompts=0")), true);
    assert.equal(records.some((record) => record.command.join(" ") === "craftr bridge version"), true);
    assert.equal(records.some((record) => record.command.join(" ") === "craftr bridge request"), true);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("RemoteBridge supports direct ssh target strings with ports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "craft-runner-remote-direct-"));
  const bin = path.join(root, "bin");
  const ssh = path.join(bin, "ssh");
  const calls = path.join(root, "calls.jsonl");
  await fs.mkdir(bin, { recursive: true });
  await writeFakeSsh(ssh, calls);

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
  try {
    await new RemoteBridge("admin@10.0.0.2:2222").request("get_stats", {});
    const records = (await fs.readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.some((record) => record.args.includes("-p") && record.args.includes("2222") && record.target === "admin@10.0.0.2"), true);
  } finally {
    process.env.PATH = previousPath;
  }
});

async function writeFakeSsh(target: string, calls: string): Promise<void> {
  await fs.writeFile(target, [
    `#!${process.execPath}`,
    "const fs = require('fs');",
    `const calls = ${JSON.stringify(calls)};`,
    "const args = process.argv.slice(2);",
    "let index = 0;",
    "while (args[index] === '-o') index += 2;",
    "let port;",
    "if (args[index] === '-p') { port = args[index + 1]; index += 2; }",
    "const target = args[index++];",
    "const command = args.slice(index);",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => input += chunk);",
    "process.stdin.on('end', () => {",
    "  fs.appendFileSync(calls, JSON.stringify({ args, port, target, command, input }) + '\\n');",
    "  if (command[0] === 'true') process.exit(0);",
    "  if (command.join(' ') === 'craftr bridge version') {",
    "    console.log(JSON.stringify({ name: '@score2/craft-runner', version: '1.0.0', bridge_protocol: { major: 1, minor: 0 }, capabilities: [] }));",
    "    process.exit(0);",
    "  }",
    "  if (command.join(' ') === 'craftr bridge request') {",
    "    const request = JSON.parse(input);",
    "    const a = request.arguments || {};",
    "    console.log(JSON.stringify({",
    "      schema: 'craft-runner-bridge-response',",
    "      version: 1,",
    "      request_id: request.request_id,",
    "      ok: true,",
    "      result: { tool: request.tool, pluginName: a.plugin_name, pluginBytes: a.plugin_content_base64 ? Buffer.from(a.plugin_content_base64, 'base64').length : undefined }",
    "    }));",
    "    process.exit(0);",
    "  }",
    "  process.exit(1);",
    "});"
  ].join("\n"));
  await fs.chmod(target, 0o755);
}
